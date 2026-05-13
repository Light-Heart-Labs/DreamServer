"""Auth-related dashboard-api endpoints.

Today: a single `/api/auth/verify-session` endpoint that validates the
HMAC-signed ``dream-session`` cookie. Used by Caddy reverse proxies
(specifically the Hermes auth-proxy) via ``forward_auth`` to gate
access on a magic-link-redeemed session without each proxy needing to
know the signing secret.

The endpoint is intentionally not gated by the dashboard's API key —
it's reachable from any reverse proxy on the bridge network. The
security model: the cookie ITSELF is the credential. Without a valid
signature, the endpoint returns 401. The endpoint never echoes
unverifiable data back to the caller.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

import session_signer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

SESSION_COOKIE_NAME = "dream-session"


@router.get("/api/auth/verify-session")
def verify_session(request: Request) -> dict:
    """Validate the dream-session cookie. Returns 200 if valid, 401 if not.

    Caddy reverse proxies use this via ``forward_auth``:

        forward_auth dashboard-api:3002 {
            uri /api/auth/verify-session
            copy_headers Cookie
        }

    Caddy forwards the original request's Cookie header here; we read
    the dream-session cookie, hand it to session_signer.verify(), and
    return 200/401 based on the result. The proxy honors the status
    code: 2xx → forward the original request to the upstream; non-2xx
    → return the forward_auth response to the client.

    Response body on success is intentionally minimal — proxies just
    care about the status code. We do return the cookie's expiry so
    callers that ALSO want to read it (e.g., the dashboard UI showing
    "session expires in N minutes") can do so without re-implementing
    the parser.
    """
    cookie_value = request.cookies.get(SESSION_COOKIE_NAME, "")
    ok, reason = session_signer.verify(cookie_value)
    if not ok:
        logger.info("verify-session denied: reason=%s", reason)
        # We don't echo the reason back to the caller — that would help
        # an attacker probe (is it expired? bad signature? no secret?).
        # Caddy only needs the status code.
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    # On success, return the expiry so the dashboard can surface "session
    # ends at X" without each consumer re-parsing the cookie. The format is
    # `<id>.<expiry>.<sig>`; we already validated the signature in verify().
    try:
        _, expiry_str, _ = cookie_value.split(".")
        expiry = int(expiry_str)
    except (ValueError, TypeError):
        # Validated above, but be defensive.
        expiry = 0

    return {"valid": True, "expires_at": expiry}
