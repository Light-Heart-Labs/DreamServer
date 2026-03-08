"""
FSM Executor for M4 Deterministic Voice Agents

Executes conversation flows defined as state machines.
Provides deterministic responses without LLM calls.
"""

import json
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any
from enum import Enum


class FlowStatus(Enum):
    """Status of flow execution."""
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CLARIFICATION_NEEDED = "clarification_needed"


@dataclass
class FlowContext:
    """Context for flow execution."""
    flow_name: str
    current_state: str
    entities: Dict[str, Any] = field(default_factory=dict)
    history: List[Dict] = field(default_factory=list)
    turn_count: int = 0
    
    def capture_entity(self, name: str, value: Any):
        """Capture an entity value."""
        self.entities[name] = value
    
    def to_dict(self) -> Dict:
        return {
            "flow_name": self.flow_name,
            "current_state": self.current_state,
            "entities": self.entities,
            "turn_count": self.turn_count,
        }


@dataclass  
class FlowResponse:
    """Response from flow execution."""
    text: str
    status: FlowStatus
    context: FlowContext
    actions: List[Dict] = field(default_factory=list)


class FSMExecutor:
    """
    Finite State Machine executor for voice conversation flows.
    
    Flows are defined as JSON state machines:
    {
      "name": "hvac_service",
      "initial_state": "S1_greeting",
      "states": {
        "S1_greeting": {
          "say": "welcome_message",
          "expect": ["schedule_service", "ask_hours"],
          "next": {...}
        }
      },
      "templates": {...}
    }
    """
    
    def __init__(self, flows_dir: Optional[str] = None, extractors: Optional[Dict[str, Callable]] = None):
        self.flows: Dict[str, Dict] = {}
        self.contexts: Dict[str, FlowContext] = {}
        self.action_handlers: Dict[str, Callable] = {}
        self.extractors: Dict[str, Callable] = extractors or {}
        
        if flows_dir:
            self.load_flows(flows_dir)
    
    def load_flows(self, directory: str):
        """Load flow definitions from directory."""
        import os
        from pathlib import Path
        
        path = Path(directory)
        for flow_file in path.glob("*.json"):
            with open(flow_file) as f:
                flow = json.load(f)
                self.flows[flow["name"]] = flow
    
    def register_action(self, name: str, handler: Callable):
        """Register an action handler."""
        self.action_handlers[name] = handler
    
    def load_extractor_registry(self, registry_module: str = "extractors"):
        """Load extractors from the registry module.
        
        The registry module can provide either:
        - A get_extractor() function that returns extractor instances with .extract() method
        - Direct extractor functions in the module (uses function name as key)
        - A DEFAULT_EXTRACTORS dict (centralized registry)
        
        This method prioritizes the centralized extractors registry for consistency.
        """
        try:
            import importlib
            registry = importlib.import_module(registry_module)
            
            # Check if registry has a DEFAULT_EXTRACTORS dict (centralized registry)
            if hasattr(registry, 'DEFAULT_EXTRACTORS') and isinstance(registry.DEFAULT_EXTRACTORS, dict):
                self.extractors = registry.DEFAULT_EXTRACTORS
                return
            
            # Check if registry has get_extractor() for class-based extractors
            if hasattr(registry, 'get_extractor'):
                self.extractors = {
                    "phone_number": lambda text: registry.get_extractor("phone_number").extract(text),
                    "date": lambda text: registry.get_extractor("date").extract(text),
                    "email": lambda text: registry.get_extractor("email").extract(text),
                    "url": lambda text: registry.get_extractor("url").extract(text),
                    "money": lambda text: registry.get_extractor("money").extract(text),
                }
            else:
                # Use direct function references for function-based extractors
                self.extractors = {
                    "phone_number": registry.extract_phone,
                    "date": registry.extract_date,
                    "email": registry.extract_email,
                    "url": registry.extract_url if hasattr(registry, 'extract_url') else None,
                    "money": registry.extract_money if hasattr(registry, 'extract_money') else None,
                }
                # Filter out None (missing) extractors
                self.extractors = {k: v for k, v in self.extractors.items() if v is not None}
        except ImportError:
            # Registry not available - use empty extractors
            self.extractors = {}
    
    def start_flow(self, flow_name: str, session_id: str) -> FlowResponse:
        """Start a new flow instance."""
        if flow_name not in self.flows:
            raise ValueError(f"Unknown flow: {flow_name}")
        
        flow = self.flows[flow_name]
        context = FlowContext(
            flow_name=flow_name,
            current_state=flow["initial_state"]
        )
        self.contexts[session_id] = context
        
        return self._execute_state(context, flow)
    
    def process_intent(self, session_id: str, intent: str, text: str) -> FlowResponse:
        """Process user intent in current flow state."""
        if session_id not in self.contexts:
            raise ValueError(f"No active flow for session: {session_id}")
        
        context = self.contexts[session_id]
        flow = self.flows[context.flow_name]
        
        # Get current state
        state_def = flow["states"].get(context.current_state, {})
        
        # Check if intent is expected
        expected = state_def.get("expect", [])
        if intent not in expected and "*" not in expected:
            # Intent not expected — request clarification or fallback
            return FlowResponse(
                text="I'm not sure I understood. Could you rephrase that?",
                status=FlowStatus.CLARIFICATION_NEEDED,
                context=context
            )
        
        # Capture entities if defined using registered extractors
        capture_def = state_def.get("capture", {})
        for entity_name, entity_type in capture_def.items():
            extractor = self.extractors.get(entity_type)
            if extractor:
                # Extractor can be either:
                # 1. A function (DEFAULT_EXTRACTORS pattern)
                # 2. An Extractor instance with .extract() method (new registry pattern)
                if hasattr(extractor, "extract"):
                    value = extractor.extract(text)
                elif callable(extractor):
                    value = extractor(text)
                else:
                    value = None
                
                if value:
                    context.capture_entity(entity_name, value)
            # If no extractor found, skip entity capture (no raw text fallback)
        
        # Determine next state
        transitions = state_def.get("next", {})
        next_state = transitions.get(intent, transitions.get("*", context.current_state))
        
        # Update context
        context.current_state = next_state
        context.turn_count += 1
        context.history.append({"intent": intent, "text": text, "state": next_state})
        
        # Execute new state
        return self._execute_state(context, flow)
    
    def _execute_state(self, context: FlowContext, flow: Dict) -> FlowResponse:
        """Execute the current state's actions."""
        state_def = flow["states"].get(context.current_state, {})
        templates = flow.get("templates", {})
        
        # Generate response text
        template_key = state_def.get("say", "default")
        template = templates.get(template_key, "I'm not sure what to say.")
        
        # Format with captured entities safely - use format_map with defaultdict
        # to prevent format string injection attacks via malicious entity values
        try:
            response_text = template.format_map(defaultdict(str, context.entities))
        except Exception:
            response_text = template  # Fallback if any formatting error occurs
        
        # Execute actions
        actions = []
        for action_def in state_def.get("actions", []):
            action_result = self._execute_action(action_def, context)
            actions.append(action_result)
        
        # Determine status
        if state_def.get("final", False):
            status = FlowStatus.COMPLETED
        else:
            status = FlowStatus.IN_PROGRESS
        
        return FlowResponse(
            text=response_text,
            status=status,
            context=context,
            actions=actions
        )
    
    def _execute_action(self, action_def: Dict, context: FlowContext) -> Dict:
        """Execute a single action."""
        action_type = action_def.get("type")
        handler = self.action_handlers.get(action_type)
        
        if handler:
            return handler(action_def, context)
        
        return {"type": action_type, "status": "unhandled"}
    
    def get_context(self, session_id: str) -> Optional[FlowContext]:
        """Get active flow context."""
        return self.contexts.get(session_id)
    
    def end_flow(self, session_id: str):
        """End a flow instance."""
        self.contexts.pop(session_id, None)


"""
H-2: Format String Injection Fix
---------------------------------
Before: template.format(**context.entities) — vulnerable to {__class__} injection
After:  template.format_map(defaultdict(str, context.entities)) — safe fallback

The defaultdict(str) ensures that missing entities or malicious entity names
always return empty string instead of raising KeyError or leaking internals.
"""

# Example flow definitions for testing
EXAMPLE_HVAC_FLOW = {
    "name": "hvac_service",
    "initial_state": "S1_greeting",
    "states": {
        "S1_greeting": {
            "say": "welcome_message",
            "expect": ["schedule_service", "ask_hours", "emergency"],
            "next": {
                "schedule_service": "S2_gather_info",
                "ask_hours": "S1_hours_response",
                "emergency": "S1_emergency_redirect"
            }
        },
        "S2_gather_info": {
            "say": "ask_name",
            "capture": {"customer_name": "name"},
            "expect": ["provide_name", "ask_skip"],
            "next": {
                "provide_name": "S3_confirm",
                "ask_skip": "S3_confirm_no_name"
            }
        },
        "S3_confirm": {
            "say": "confirm_appointment",
            "expect": ["confirm", "reschedule", "cancel"],
            "next": {
                "confirm": "S4_complete",
                "reschedule": "S2_gather_info",
                "cancel": "S4_cancelled"
            }
        },
        "S4_complete": {
            "say": "appointment_confirmed",
            "final": True
        },
        "S4_cancelled": {
            "say": "appointment_cancelled",
            "final": True
        }
    },
    "templates": {
        "welcome_message": "Hello! Thank you for calling HVAC Services. How can I help you today?",
        "ask_name": "May I have your name, please?",
        "confirm_appointment": "Great, {customer_name}. I've scheduled your appointment.",
        "appointment_confirmed": "You're all set! We'll see you soon.",
        "appointment_cancelled": "No problem. Feel free to call back anytime."
    }
}
