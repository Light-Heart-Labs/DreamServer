"""
LiveKit Adapter for M4 Deterministic Voice Agents

Bridges LiveKit voice sessions with FSM flows.
Handles session lifecycle, intent routing, and entity extraction.

Usage:
    adapter = LiveKitFSMAdapter(fsm_executor, classifier)
    response = await adapter.handle_utterance(session_id, text)
"""

import asyncio
import time
from typing import Dict, Optional, Any, Callable
from dataclasses import dataclass

from .classifier import IntentClassifier, ClassificationResult
from .fsm import FSMExecutor, FlowResponse, FlowStatus
from .extractors import (
    extract_date,
    extract_time_preference,
    extract_name,
    extract_phone,
    extract_email,
    extract_yes_no,
    DEFAULT_EXTRACTORS,
)

@dataclass
class AdapterResponse:
    """Response from the LiveKit adapter."""
    text: str
    intent: str
    confidence: float
    used_deterministic: bool
    latency_ms: float
    flow_status: Optional[str] = None
    entities: Optional[Dict[str, Any]] = None


class LiveKitFSMAdapter:
    """
    Adapter connecting LiveKit voice sessions to FSM flows.
    
    Manages:
    - Session → FSM context mapping
    - Intent classification on each utterance
    - Flow state transitions
    - Entity extraction for slot filling
    
    Usage:
        adapter = LiveKitFSMAdapter(fsm, classifier)
        
        # On new call
        response = await adapter.start_session(session_id, "hvac_service")
        
        # On each user utterance
        response = await adapter.handle_utterance(session_id, user_text)
        
        # On call end
        adapter.end_session(session_id)
    """
    
    def __init__(
        self,
        fsm: FSMExecutor,
        classifier: IntentClassifier,
        confidence_threshold: float = 0.85,
        entity_extractors: Optional[Dict[str, Callable]] = None
    ):
        self.fsm = fsm
        self.classifier = classifier
        self.confidence_threshold = confidence_threshold
        self.entity_extractors = entity_extractors or {}
        
        # Session state tracking
        self.active_sessions: Dict[str, Dict[str, Any]] = {}
        
        # Metrics
        self.total_requests = 0
        self.deterministic_requests = 0
        self.fallback_requests = 0
        self.total_latency_ms = 0.0
    
    async def start_session(
        self,
        session_id: str,
        flow_name: str,
        initial_context: Optional[Dict[str, Any]] = None
    ) -> AdapterResponse:
        """
        Start a new voice session with FSM flow.
        
        Args:
            session_id: LiveKit session identifier
            flow_name: Name of the FSM flow to start
            initial_context: Optional initial entity values
            
        Returns:
            AdapterResponse with greeting text
        """
        start_time = time.time()
        
        try:
            # Start the flow
            flow_response = self.fsm.start_flow(flow_name, session_id)
            
            # Store session state
            self.active_sessions[session_id] = {
                "flow_name": flow_name,
                "started_at": time.time(),
                "turn_count": 0
            }
            
            latency_ms = (time.time() - start_time) * 1000
            self.total_requests += 1
            self.deterministic_requests += 1
            self.total_latency_ms += latency_ms
            
            return AdapterResponse(
                text=flow_response.text,
                intent="greeting",
                confidence=1.0,
                used_deterministic=True,
                latency_ms=latency_ms,
                flow_status=flow_response.status.value,
                entities={}
            )
            
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            return AdapterResponse(
                text="Hello! How can I help you today?",
                intent="fallback",
                confidence=0.0,
                used_deterministic=False,
                latency_ms=latency_ms
            )
    
    async def handle_utterance(
        self,
        session_id: str,
        text: str
    ) -> AdapterResponse:
        """
        Handle a user utterance in an active session.
        
        Args:
            session_id: LiveKit session identifier
            text: User's speech-to-text utterance
            
        Returns:
            AdapterResponse with response text and routing info
        """
        start_time = time.time()
        
        # Step 1: Classify intent
        classification = self.classifier.predict(text)
        intent = classification.intent
        confidence = classification.confidence
        
        # Step 2: Route based on confidence
        if confidence < self.confidence_threshold:
            # Low confidence — fall back to LLM
            latency_ms = (time.time() - start_time) * 1000
            self.total_requests += 1
            self.fallback_requests += 1
            self.total_latency_ms += latency_ms
            
            return AdapterResponse(
                text="",  # Signal to use LLM
                intent=intent,
                confidence=confidence,
                used_deterministic=False,
                latency_ms=latency_ms
            )
        
        # Step 3: Try deterministic path
        try:
            # Check if we have an active flow
            session = self.active_sessions.get(session_id)
            flow_context = self.fsm.get_context(session_id)
            
            if flow_context is None:
                # No active flow — try to start one based on intent
                flow_name = self._intent_to_flow(intent)
                if flow_name and flow_name in self.fsm.flows:
                    flow_response = self.fsm.start_flow(flow_name, session_id)
                    self.active_sessions[session_id] = {
                        "flow_name": flow_name,
                        "started_at": time.time(),
                        "turn_count": 1
                    }
                else:
                    # No matching flow — fall back to LLM
                    latency_ms = (time.time() - start_time) * 1000
                    self.total_requests += 1
                    self.fallback_requests += 1
                    self.total_latency_ms += latency_ms
                    
                    return AdapterResponse(
                        text="",
                        intent=intent,
                        confidence=confidence,
                        used_deterministic=False,
                        latency_ms=latency_ms
                    )
            else:
                # Continue existing flow
                # Extract entities before processing
                self._extract_entities(session_id, text, flow_context)
                
                # Process intent in current flow state
                flow_response = self.fsm.process_intent(session_id, intent, text)
                
                # Update session tracking
                if session_id in self.active_sessions:
                    self.active_sessions[session_id]["turn_count"] += 1
            
            # Calculate latency
            latency_ms = (time.time() - start_time) * 1000
            self.total_requests += 1
            self.deterministic_requests += 1
            self.total_latency_ms += latency_ms
            
            # Check if flow completed
            if flow_response.status == FlowStatus.COMPLETED:
                # End the flow but keep session for potential new flow
                self.fsm.end_flow(session_id)
                self.active_sessions.pop(session_id, None)
            
            return AdapterResponse(
                text=flow_response.text,
                intent=intent,
                confidence=confidence,
                used_deterministic=True,
                latency_ms=latency_ms,
                flow_status=flow_response.status.value,
                entities=flow_response.context.entities if flow_response.context else {}
            )
            
        except Exception as e:
            # FSM error — fall back to LLM
            latency_ms = (time.time() - start_time) * 1000
            self.total_requests += 1
            self.fallback_requests += 1
            self.total_latency_ms += latency_ms
            
            return AdapterResponse(
                text="",
                intent=intent,
                confidence=confidence,
                used_deterministic=False,
                latency_ms=latency_ms
            )
    
    def end_session(self, session_id: str):
        """End a voice session and clean up FSM context."""
        self.fsm.end_flow(session_id)
        self.active_sessions.pop(session_id, None)
    
    def _intent_to_flow(self, intent: str) -> Optional[str]:
        """Map intent to flow name."""
        mapping = {
            # High-level intents (M4 taxonomy)
            "schedule_service": "hvac_service",
            "emergency": "hvac_service",
            "check_status": "status_check",
            "hours_location": "business_info",
            "transfer_human": "human_transfer",
            "goodbye": "end_conversation",
            # Flow-specific intents (route to hvac_service for processing)
            "describe_issue": "hvac_service",
            "provide_time": "hvac_service",
            "provide_date": "hvac_service",
            "provide_name": "hvac_service",
            "provide_service_type": "hvac_service",
            "provide_contact": "hvac_service",
            "confirm_yes": "hvac_service",
            "confirm_no": "hvac_service",
            "check_order": "hvac_service",
            "modify_order": "hvac_service",
            "cancel_order": "hvac_service",
            "ask_question": "hvac_service",
            "get_quote": "hvac_service",
            "take_order": "hvac_service",
            "troubleshoot": "hvac_service",
            "fallback": "hvac_service",
            # Special cases (legacy/alternative names)
            "emergency_repair": "hvac_service",
            "cancel_reschedule": "modification",
        }
        return mapping.get(intent)
    
    def _extract_entities(
        self,
        session_id: str,
        text: str,
        flow_context: Any
    ):
        """Extract entities from text and update context."""
        # Get current state to know what entities to extract
        flow = self.fsm.flows.get(flow_context.flow_name, {})
        state_def = flow.get("states", {}).get(flow_context.current_state, {})
        capture_def = state_def.get("capture", {})
        
        for entity_name, entity_type in capture_def.items():
            # Use registered extractor if available
            extractor = self.entity_extractors.get(entity_type)
            if extractor:
                value = extractor(text)
                if value:
                    flow_context.capture_entity(entity_name, value)
            else:
                # Simple fallback: store raw text
                flow_context.capture_entity(entity_name, text)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get adapter performance metrics."""
        if self.total_requests == 0:
            return {
                "total_requests": 0,
                "deterministic_rate": 0.0,
                "fallback_rate": 0.0,
                "avg_latency_ms": 0.0
            }
        
        return {
            "total_requests": self.total_requests,
            "deterministic_requests": self.deterministic_requests,
            "fallback_requests": self.fallback_requests,
            "deterministic_rate": self.deterministic_requests / self.total_requests,
            "fallback_rate": self.fallback_requests / self.total_requests,
            "avg_latency_ms": self.total_latency_ms / self.total_requests,
            "active_sessions": len(self.active_sessions)
        }
    
    def reset_metrics(self):
        """Reset performance metrics."""
        self.total_requests = 0
        self.deterministic_requests = 0
        self.fallback_requests = 0
        self.total_latency_ms = 0.0
