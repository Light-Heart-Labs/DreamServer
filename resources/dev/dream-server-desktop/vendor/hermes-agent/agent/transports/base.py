"""Abstract base for provider transports.

A transport owns the data path for one api_mode:
  convert_messages -> convert_tools -> build_kwargs -> normalize_response

It does not own client construction, streaming, credential refresh, prompt
caching, interrupt handling, or retry logic. Those stay on AIAgent.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from agent.transports.types import NormalizedResponse


class ProviderTransport(ABC):
    """Base class for provider-specific format conversion and normalization."""

    @property
    @abstractmethod
    def api_mode(self) -> str:
        """The api_mode string this transport handles."""
        ...

    @abstractmethod
    def convert_messages(self, messages: List[Dict[str, Any]], **kwargs) -> Any:
        """Convert OpenAI-format messages to provider-native format."""
        ...

    @abstractmethod
    def convert_tools(self, tools: List[Dict[str, Any]]) -> Any:
        """Convert OpenAI-format tool definitions to provider-native format."""
        ...

    @abstractmethod
    def build_kwargs(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        **params,
    ) -> Dict[str, Any]:
        """Build a provider SDK call kwargs dict."""
        ...

    @abstractmethod
    def normalize_response(self, response: Any, **kwargs) -> NormalizedResponse:
        """Normalize a raw provider response to the shared transport type."""
        ...

    def validate_response(self, response: Any) -> bool:
        """Return whether the raw response should be treated as structurally valid."""
        return True

    def extract_cache_stats(self, response: Any) -> Optional[Dict[str, int]]:
        """Extract provider-specific cache token stats when available."""
        return None

    def map_finish_reason(self, raw_reason: str) -> str:
        """Map provider-specific finish reasons when needed."""
        return raw_reason
