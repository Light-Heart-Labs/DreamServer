"""Token Spy Sidecar - Transparent LLM API Proxy.

A middleware proxy that intercepts LLM API calls, logs usage metrics,
and forwards requests to upstream providers. Zero code changes required
in your applications.
"""

__version__ = "0.1.0"
__author__ = "Android-16"

from .proxy import proxy_messages, proxy_chat_completions
from .env_loader import load_env, save_env, set_env_from_file

__all__ = [
    "proxy_messages",
    "proxy_chat_completions",
    "load_env",
    "save_env",
    "set_env_from_file",
    "__version__",
]
