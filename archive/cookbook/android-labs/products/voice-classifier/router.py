"""
Deterministic Router for M4 Voice Agents

Routes user requests between FSM (deterministic) and LLM (fallback).
The decision engine for the M4 deterministic layer.
"""

import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Dict, Any

from .classifier import IntentClassifier, ClassificationResult
from .fsm import FSMExecutor, FlowResponse, FlowStatus


class RoutingTarget(Enum):
    """Where to route the request."""
    DETERMINISTIC = "deterministic"  # Use FSM
    FALLBACK = "fallback"            # Use LLM
    CLARIFICATION = "clarification"  # Ask user to rephrase


@dataclass
class RoutingDecision:
    """Result of routing decision."""
    target: RoutingTarget
    intent: str
    confidence: float
    response_text: Optional[str] = None
    flow_response: Optional[FlowResponse] = None
    latency_ms: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "target": self.target.value,
            "intent": self.intent,
            "confidence": self.confidence,
            "latency_ms": self.latency_ms,
            "used_deterministic": self.target == RoutingTarget.DETERMINISTIC
        }


class DeterministicRouter:
    """
    Routes voice requests between deterministic (FSM) and LLM paths.
    
    Decision logic:
    - Confidence ≥ 0.85: Route to FSM (deterministic)
    - Confidence 0.70-0.85: Route to LLM with intent hint
    - Confidence < 0.70: Route to LLM (full fallback)
    
    Usage:
        router = DeterministicRouter(
            classifier=DistilBERTClassifier(),
            fsm=FSMExecutor(),
            fallback_threshold=0.85
        )
        
        decision = await router.route(user_text, session_context)
        if decision.target == RoutingTarget.DETERMINISTIC:
            # Use decision.response_text (no LLM call)
            pass
        else:
            # Fall back to LLM
            pass
    """
    
    def __init__(
        self,
        classifier: IntentClassifier,
        fsm: FSMExecutor,
        fallback_threshold: float = 0.85,
        clarification_threshold: float = 0.70,
        enable_metrics: bool = True
    ):
        self.classifier = classifier
        self.fsm = fsm
        self.fallback_threshold = fallback_threshold
        self.clarification_threshold = clarification_threshold
        self.enable_metrics = enable_metrics
        
        # Metrics
        self.total_routes = 0
        self.deterministic_routes = 0
        self.fallback_routes = 0
        self.avg_latency_ms = 0.0
    
    async def route(
        self,
        text: str,
        session_context: Dict[str, Any],
        session_id: str
    ) -> RoutingDecision:
        """
        Route a user request.
        
        Args:
            text: User utterance
            session_context: Current session state
            session_id: Unique session identifier
            
        Returns:
            RoutingDecision with target and response (if deterministic)
        """
        start_time = time.time()
        
        # Step 1: Classify intent
        classification = self.classifier.predict(text)
        intent = classification.intent
        confidence = classification.confidence
        
        # Step 2: Make routing decision
        if confidence >= self.fallback_threshold:
            # High confidence — try deterministic path
            decision = await self._route_deterministic(
                intent, text, session_id, classification
            )
        elif confidence >= self.clarification_threshold:
            # Medium confidence — LLM with hint
            decision = RoutingDecision(
                target=RoutingTarget.FALLBACK,
                intent=intent,
                confidence=confidence,
                latency_ms=(time.time() - start_time) * 1000
            )
        else:
            # Low confidence — full LLM fallback
            decision = RoutingDecision(
                target=RoutingTarget.FALLBACK,
                intent="unknown",
                confidence=confidence,
                latency_ms=(time.time() - start_time) * 1000
            )
        
        # Update metrics
        if self.enable_metrics:
            self._update_metrics(decision)
        
        return decision
    
    async def _route_deterministic(
        self,
        intent: str,
        text: str,
        session_id: str,
        classification: ClassificationResult
    ) -> RoutingDecision:
        """Route through FSM (deterministic path)."""
        start_time = time.time()
        
        try:
            # Check if we have an active flow
            flow_context = self.fsm.get_context(session_id)
            
            if flow_context is None:
                # Start new flow based on intent
                # Map intent to flow name
                flow_name = self._intent_to_flow(intent)
                if flow_name and flow_name in self.fsm.flows:
                    flow_response = self.fsm.start_flow(flow_name, session_id)
                else:
                    # No matching flow — fallback to LLM
                    return RoutingDecision(
                        target=RoutingTarget.FALLBACK,
                        intent=intent,
                        confidence=classification.confidence,
                        latency_ms=(time.time() - start_time) * 1000
                    )
            else:
                # Continue existing flow
                flow_response = self.fsm.process_intent(session_id, intent, text)
            
            # Check if flow completed or needs clarification
            if flow_response.status == FlowStatus.CLARIFICATION_NEEDED:
                return RoutingDecision(
                    target=RoutingTarget.CLARIFICATION,
                    intent=intent,
                    confidence=classification.confidence,
                    response_text=flow_response.text,
                    flow_response=flow_response,
                    latency_ms=(time.time() - start_time) * 1000
                )
            
            # Successful deterministic response
            return RoutingDecision(
                target=RoutingTarget.DETERMINISTIC,
                intent=intent,
                confidence=classification.confidence,
                response_text=flow_response.text,
                flow_response=flow_response,
                latency_ms=(time.time() - start_time) * 1000
            )
            
        except Exception as e:
            # FSM error — fall back to LLM
            return RoutingDecision(
                target=RoutingTarget.FALLBACK,
                intent=intent,
                confidence=classification.confidence,
                latency_ms=(time.time() - start_time) * 1000
            )
    
    def _intent_to_flow(self, intent: str) -> Optional[str]:
        """Map intent to flow name.
        
        Returns None for terminal/neutral intents that should fall back to LLM:
        - goodbye, confirm_yes, confirm_no: Handled by LLM for natural exit
        - fallback: Explicit fallback indicator → LLM
        - provide_* intents: Context-dependent, better handled by LLM
        """
        intent_flow_map = {
            # HVAC service flows
            "schedule_service": "hvac_service",
            "emergency": "hvac_service",
            "check_status": "hvac_service",
            "get_quote": "hvac_service",
            "troubleshoot": "hvac_service",
            "hours_location": "hvac_service",
            "transfer_human": "hvac_service",
            # Restaurant booking flows
            "book_table": "restaurant_booking",
            "check_order": "restaurant_booking",
            "modify_order": "restaurant_booking",
            "cancel_order": "restaurant_booking",
            "take_order": "restaurant_booking",
            # Tech support flows
            "tech_support": "tech_support",
            "ask_question": "tech_support",
            "describe_issue": "tech_support",
            # Default fallback (return None → LLM)
            "goodbye": None,
            "confirm_yes": None,
            "confirm_no": None,
            "provide_time": None,
            "provide_date": None,
            "provide_name": None,
            "provide_service_type": None,
            "provide_contact": None,
            "fallback": None,
        }
        return intent_flow_map.get(intent)
    
    def _update_metrics(self, decision: RoutingDecision):
        """Update routing metrics."""
        self.total_routes += 1
        
        if decision.target == RoutingTarget.DETERMINISTIC:
            self.deterministic_routes += 1
        elif decision.target == RoutingTarget.FALLBACK:
            self.fallback_routes += 1
        
        # Rolling average latency
        self.avg_latency_ms = (
            (self.avg_latency_ms * (self.total_routes - 1) + decision.latency_ms)
            / self.total_routes
        )
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get routing metrics."""
        if self.total_routes == 0:
            return {
                "total_routes": 0,
                "deterministic_rate": 0.0,
                "fallback_rate": 0.0,
                "avg_latency_ms": 0.0
            }
        
        return {
            "total_routes": self.total_routes,
            "deterministic_routes": self.deterministic_routes,
            "fallback_routes": self.fallback_routes,
            "deterministic_rate": self.deterministic_routes / self.total_routes,
            "fallback_rate": self.fallback_routes / self.total_routes,
            "avg_latency_ms": self.avg_latency_ms
        }
    
    def reset_metrics(self):
        """Reset metrics counters."""
        self.total_routes = 0
        self.deterministic_routes = 0
        self.fallback_routes = 0
        self.avg_latency_ms = 0.0


# Integration helper for LiveKit
def create_deterministic_router(
    flows_dir: str,
    classifier_type: str = "keyword",  # or "distilbert", "qwen"
    fallback_threshold: float = 0.85
) -> DeterministicRouter:
    """
    Factory function to create a configured router.
    
    Usage:
        router = create_deterministic_router(
            flows_dir="./flows",
            classifier_type="distilbert"
        )
    """
    from .classifier import KeywordClassifier, DistilBERTClassifier
    
    # Create classifier
    if classifier_type == "keyword":
        # Test classifier with HVAC intents
        classifier = KeywordClassifier({
            "schedule_service": ["book", "schedule", "appointment", "service"],
            "emergency": ["urgent", "emergency", "broken", "not working"],
            "ask_hours": ["hours", "open", "when", "time"],
        })
    elif classifier_type == "distilbert":
        classifier = DistilBERTClassifier()
    else:
        raise ValueError(f"Unknown classifier type: {classifier_type}")
    
    # Create FSM
    fsm = FSMExecutor(flows_dir)
    
    return DeterministicRouter(
        classifier=classifier,
        fsm=fsm,
        fallback_threshold=fallback_threshold
    )
