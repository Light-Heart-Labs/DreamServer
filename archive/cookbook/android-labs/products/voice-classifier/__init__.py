"""
M4 Deterministic Voice Layer

Provides intent classification and deterministic routing for voice agents.
Reduces LLM dependence by routing known intents through FSM executor.

Usage:
    from deterministic import DeterministicRouter, IntentClassifier
    
    router = DeterministicRouter(
        classifier=IntentClassifier(),
        fsm=FSMExecutor(),
        fallback_threshold=0.85
    )
    
    response = await router.route(user_text, context)
"""

from .classifier import (
    IntentClassifier,
    ClassificationResult,
    KeywordClassifier,
    QwenClassifier,
    DistilBERTClassifier,
)
from .fsm import FSMExecutor, FlowContext, FlowResponse, FlowStatus
from .router import DeterministicRouter, RoutingDecision, RoutingTarget
from .livekit_adapter import LiveKitFSMAdapter, AdapterResponse, DEFAULT_EXTRACTORS

__all__ = [
    'IntentClassifier',
    'ClassificationResult',
    'KeywordClassifier',
    'QwenClassifier',
    'DistilBERTClassifier',
    'FSMExecutor',
    'FlowContext',
    'FlowResponse',
    'FlowStatus',
    'DeterministicRouter',
    'RoutingDecision',
    'RoutingTarget',
    'LiveKitFSMAdapter',
    'AdapterResponse',
    'DEFAULT_EXTRACTORS',
]
