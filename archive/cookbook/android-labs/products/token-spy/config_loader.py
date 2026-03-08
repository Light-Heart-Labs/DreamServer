"""
Provider Configuration Loader

Loads provider definitions from YAML config and provides runtime access
to provider settings, pricing, and transformations.
"""

import os
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from functools import lru_cache

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


@dataclass
class ModelPricing:
    """Pricing for a specific model."""
    name: str
    input_per_1m: float
    output_per_1m: float
    cache_read_per_1m: float = 0.0
    cache_write_per_1m: float = 0.0
    context_window: int = 128000
    
    def calculate_cost(
        self,
        input_tokens: int,
        output_tokens: int,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> float:
        """Calculate cost in USD for given token counts."""
        return (
            input_tokens * self.input_per_1m / 1_000_000 +
            output_tokens * self.output_per_1m / 1_000_000 +
            cache_read_tokens * self.cache_read_per_1m / 1_000_000 +
            cache_write_tokens * self.cache_write_per_1m / 1_000_000
        )


@dataclass
class AuthConfig:
    """Authentication configuration for a provider."""
    type: str  # 'header', 'query_param', 'none'
    header_name: Optional[str] = None
    header_prefix: Optional[str] = None
    query_param: Optional[str] = None


@dataclass
class RequestTransform:
    """Request transformation rule."""
    type: str  # 'role_map', 'header_add', 'header_remove'
    mapping: Optional[Dict[str, str]] = None
    headers: Optional[Dict[str, str]] = None


@dataclass
class ProviderConfig:
    """Configuration for a single provider."""
    name: str
    provider_id: str
    adapter: str
    base_url: str
    api_version: Optional[str] = None
    auth: AuthConfig = field(default_factory=lambda: AuthConfig(type="none"))
    models: Dict[str, ModelPricing] = field(default_factory=dict)
    transforms: List[RequestTransform] = field(default_factory=list)
    
    def get_model_pricing(self, model: str) -> ModelPricing:
        """Get pricing for a model. Supports wildcard matching."""
        # Exact match
        if model in self.models:
            return self.models[model]
        
        # Try wildcard
        if "*" in self.models:
            return self.models["*"]
        
        # Default pricing (unknown model)
        return ModelPricing(
            name=model,
            input_per_1m=0.0,
            output_per_1m=0.0,
        )
    
    def resolve_base_url(self) -> str:
        """Resolve base URL with environment variable substitution."""
        return _resolve_env_vars(self.base_url)


@dataclass
class AdapterConfig:
    """Configuration for a provider adapter."""
    name: str
    adapter_id: str
    request_format: str
    response_format: str
    streaming: bool = True
    sse_event_types: bool = False


@dataclass
class GlobalSettings:
    """Global Token Spy settings."""
    default_provider: str = "anthropic"
    default_rate_limit_rpm: int = 60
    default_rate_limit_rpd: int = 10000
    cost_alert_threshold_usd: float = 10.0
    default_session_char_limit: int = 200000
    session_poll_interval_minutes: int = 5
    retention_raw_days: int = 30
    retention_hourly_days: int = 365


class ProviderConfigLoader:
    """Loads and manages provider configuration from YAML."""
    
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or os.environ.get(
            "CONFIG_PATH", 
            os.path.join(os.path.dirname(__file__), "config", "providers.yaml")
        )
        self._providers: Dict[str, ProviderConfig] = {}
        self._adapters: Dict[str, AdapterConfig] = {}
        self._settings: GlobalSettings = GlobalSettings()
        self._loaded = False
    
    def load(self) -> "ProviderConfigLoader":
        """Load configuration from YAML file."""
        if self._loaded:
            return self
        
        if not HAS_YAML:
            raise ImportError(
                "PyYAML is required for config loading. "
                "Install with: pip install pyyaml"
            )
        
        if not os.path.exists(self.config_path):
            raise FileNotFoundError(f"Provider config not found: {self.config_path}")
        
        with open(self.config_path, "r") as f:
            config = yaml.safe_load(f)
        
        # Load providers
        for provider_id, provider_data in config.get("providers", {}).items():
            self._providers[provider_id] = self._parse_provider(provider_id, provider_data)
        
        # Load adapters
        for adapter_id, adapter_data in config.get("adapters", {}).items():
            self._adapters[adapter_id] = self._parse_adapter(adapter_id, adapter_data)
        
        # Load settings
        self._settings = self._parse_settings(config.get("settings", {}))
        
        self._loaded = True
        return self
    
    def _parse_provider(self, provider_id: str, data: Dict[str, Any]) -> ProviderConfig:
        """Parse a provider configuration."""
        # Parse auth config
        auth_data = data.get("auth", {"type": "none"})
        auth = AuthConfig(
            type=auth_data.get("type", "none"),
            header_name=auth_data.get("header_name"),
            header_prefix=auth_data.get("header_prefix"),
            query_param=auth_data.get("query_param"),
        )
        
        # Parse model pricing
        models = {}
        for model_id, model_data in data.get("models", {}).items():
            models[model_id] = ModelPricing(
                name=model_data.get("name", model_id),
                input_per_1m=model_data.get("input", 0.0),
                output_per_1m=model_data.get("output", 0.0),
                cache_read_per_1m=model_data.get("cache_read", 0.0),
                cache_write_per_1m=model_data.get("cache_write", 0.0),
                context_window=model_data.get("context_window", 128000),
            )
        
        # Parse transforms
        transforms = []
        for transform_data in data.get("request_transforms", []):
            transforms.append(RequestTransform(
                type=transform_data.get("type", ""),
                mapping=transform_data.get("mapping"),
                headers=transform_data.get("headers"),
            ))
        
        return ProviderConfig(
            name=data.get("name", provider_id),
            provider_id=provider_id,
            adapter=data.get("adapter", "openai_chat"),
            base_url=data.get("base_url", ""),
            api_version=data.get("api_version"),
            auth=auth,
            models=models,
            transforms=transforms,
        )
    
    def _parse_adapter(self, adapter_id: str, data: Dict[str, Any]) -> AdapterConfig:
        """Parse an adapter configuration."""
        return AdapterConfig(
            name=data.get("name", adapter_id),
            adapter_id=adapter_id,
            request_format=data.get("request_format", "openai"),
            response_format=data.get("response_format", "openai"),
            streaming=data.get("streaming", True),
            sse_event_types=data.get("sse_event_types", False),
        )
    
    def _parse_settings(self, data: Dict[str, Any]) -> GlobalSettings:
        """Parse global settings."""
        return GlobalSettings(
            default_provider=data.get("default_provider", "anthropic"),
            default_rate_limit_rpm=data.get("default_rate_limit_rpm", 60),
            default_rate_limit_rpd=data.get("default_rate_limit_rpd", 10000),
            cost_alert_threshold_usd=data.get("cost_alert_threshold_usd", 10.0),
            default_session_char_limit=data.get("default_session_char_limit", 200000),
            session_poll_interval_minutes=data.get("session_poll_interval_minutes", 5),
            retention_raw_days=data.get("retention_raw_days", 30),
            retention_hourly_days=data.get("retention_hourly_days", 365),
        )
    
    def get_provider(self, provider_id: str) -> Optional[ProviderConfig]:
        """Get a provider by ID."""
        if not self._loaded:
            self.load()
        return self._providers.get(provider_id)
    
    def list_providers(self) -> List[str]:
        """List all configured provider IDs."""
        if not self._loaded:
            self.load()
        return list(self._providers.keys())
    
    def get_adapter(self, adapter_id: str) -> Optional[AdapterConfig]:
        """Get an adapter by ID."""
        if not self._loaded:
            self.load()
        return self._adapters.get(adapter_id)
    
    @property
    def settings(self) -> GlobalSettings:
        """Get global settings."""
        if not self._loaded:
            self.load()
        return self._settings
    
    def reload(self) -> "ProviderConfigLoader":
        """Reload configuration from disk."""
        self._loaded = False
        self._providers.clear()
        self._adapters.clear()
        return self.load()


def _resolve_env_vars(value: str) -> str:
    """Resolve environment variables in a string.
    
    Supports ${VAR} and ${VAR:-default} syntax.
    """
    import re
    
    pattern = r'\$\{(\w+)(?::-(.*?))?\}'
    
    def replacer(match):
        var_name = match.group(1)
        default = match.group(2) or ""
        return os.environ.get(var_name, default)
    
    return re.sub(pattern, replacer, value)


# Global singleton instance
_config_loader: Optional[ProviderConfigLoader] = None


def get_config_loader() -> ProviderConfigLoader:
    """Get the global config loader instance."""
    global _config_loader
    if _config_loader is None:
        _config_loader = ProviderConfigLoader().load()
    return _config_loader


def reload_config() -> ProviderConfigLoader:
    """Reload the global configuration."""
    global _config_loader
    _config_loader = ProviderConfigLoader().load()
    return _config_loader


# Convenience functions
def get_provider(provider_id: str) -> Optional[ProviderConfig]:
    """Get a provider configuration by ID."""
    return get_config_loader().get_provider(provider_id)


def get_default_provider() -> Optional[ProviderConfig]:
    """Get the default provider configuration."""
    loader = get_config_loader()
    return loader.get_provider(loader.settings.default_provider)


def list_providers() -> List[str]:
    """List all configured provider IDs."""
    return get_config_loader().list_providers()


def get_settings() -> GlobalSettings:
    """Get global settings."""
    return get_config_loader().settings
