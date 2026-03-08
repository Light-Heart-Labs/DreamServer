"""
Token Spy Provider Key Resolver

Integrates encrypted provider keys from the dashboard into the proxy.
Fetches the active key for a tenant/provider and decrypts it for upstream use.
"""

import logging
from typing import Optional

from .db_backend import get_db, decrypt_provider_key

log = logging.getLogger("token-spy-provider-keys")

# ── Provider Key Resolution ─────────────────────────────────────────────────

async def get_upstream_api_key(
    tenant_id: str,
    provider: str,
    fallback_env_var: Optional[str] = None
) -> Optional[str]:
    """Get the API key for upstream requests.
    
    Resolution order:
    1. Look up active provider key for tenant in database
    2. Decrypt the key
    3. Fall back to environment variable if no key found
    
    Args:
        tenant_id: The tenant ID from auth context
        provider: Provider type ('anthropic', 'openai', 'google', 'local')
        fallback_env_var: Env var name for fallback (e.g., 'UPSTREAM_API_KEY')
    
    Returns:
        Decrypted API key or None if not found
    """
    db = get_db()
    
    # Try to get from database
    provider_key = db.get_active_provider_key(tenant_id, provider)
    
    if provider_key:
        try:
            decrypted = decrypt_provider_key(
                provider_key.encrypted_key,
                provider_key.iv
            )
            log.info(f"Using provider key for tenant={tenant_id} provider={provider}")
            return decrypted
        except Exception as e:
            log.error(f"Failed to decrypt provider key: {e}")
            # Fall through to fallback
    
    # Fallback to environment variable
    if fallback_env_var:
        import os
        fallback = os.environ.get(fallback_env_var)
        if fallback:
            log.debug(f"Using fallback env var {fallback_env_var} for tenant={tenant_id}")
            return fallback
    
    return None


# ── Provider Key Selection by Model ─────────────────────────────────────────

def get_provider_for_model(model: str) -> str:
    """Determine provider type from model name.
    
    This is a heuristic for routing to the correct provider key
    when the explicit provider isn't specified.
    """
    model_lower = model.lower()
    
    if 'claude' in model_lower:
        return 'anthropic'
    elif 'gpt' in model_lower or model_lower.startswith('text-'):
        return 'openai'
    elif 'gemini' in model_lower or 'palm' in model_lower:
        return 'google'
    elif any(x in model_lower for x in ['qwen', 'llama', 'mistral', 'local']):
        return 'local'
    
    # Default to anthropic for unknown models
    return 'anthropic'


# ── Integration with Proxy ──────────────────────────────────────────────────

"""
Integration complete. See proxy.py for implementation.

The proxy now wires provider keys resolver into both proxy_messages()
and proxy_chat_completions() request handlers. The flow:

1. Extract tenant_id from request.state.tenant.tenant_id (set by auth middleware)
2. Determine provider from model name using get_provider_for_model()
3. Call get_upstream_api_key() to get encrypted key from DB or fallback to env var
4. Inject appropriate header (x-api-key for Anthropic, Bearer for OpenAI)

Database migration required for provider_keys table (see schema/ directory).
Encryption key (PROVIDER_KEY_SECRET) must be shared between dashboard and sidecar.
"""
