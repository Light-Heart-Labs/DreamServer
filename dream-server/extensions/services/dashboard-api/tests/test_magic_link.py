"""Tests for routers/magic_link.py — magic-link auth (generate / redeem / list / revoke).

Covers:
  * Auth enforcement on admin endpoints
  * Generate happy path (returns plaintext token + URL)
  * Generate validation (bad username, expiry bounds, scope enum)
  * Redeem happy path (single-use, sets session cookie, 302 to chat)
  * Redeem failure modes (invalid, expired, already-redeemed, revoked) → all
    return the same opaque 404
  * Reusable-token semantics (can redeem twice, still tracked in audit)
  * Rate-limit on repeated failures
  * List + revoke flows
"""

import importlib
import time
from datetime import datetime, timedelta, timezone

import pytest


# ---------------------------------------------------------------------------
# Fixtures — isolate per-test storage + rate-limit state
# ---------------------------------------------------------------------------


@pytest.fixture()
def magic_link_module(tmp_path, monkeypatch):
    """Reload routers.magic_link with an isolated DATA_DIR and clean state."""
    monkeypatch.setenv("DREAM_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DREAM_PUBLIC_URL", raising=False)
    monkeypatch.delenv("WEBUI_URL", raising=False)
    monkeypatch.delenv("DREAM_TRUST_FORWARDED", raising=False)

    # Reimport so module-level constants pick up the new DATA_DIR.
    from routers import magic_link as ml
    importlib.reload(ml)

    # Reset in-memory rate-limit table between tests.
    ml._RATE_LIMIT_BUCKETS.clear()

    # The main app already imported the router at module load — re-include the
    # reloaded one so the TestClient routes to fresh module state.
    from main import app
    # FastAPI's APIRouter is by-reference; reloading the module replaces
    # ml.router with a new instance. Re-mount it.
    app.include_router(ml.router)
    return ml


@pytest.fixture()
def magic_link_client(test_client, magic_link_module):
    """TestClient wired to the freshly-reloaded magic_link router."""
    return test_client


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


def test_generate_requires_auth(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice"},
    )
    assert resp.status_code == 401


def test_list_requires_auth(magic_link_client):
    resp = magic_link_client.get("/api/auth/magic-link/list")
    assert resp.status_code == 401


def test_revoke_requires_auth(magic_link_client):
    resp = magic_link_client.delete("/api/auth/magic-link/abcd1234")
    assert resp.status_code == 401


def test_qr_requires_auth(magic_link_client):
    resp = magic_link_client.get("/api/auth/magic-link/qr?url=http://example/")
    assert resp.status_code == 401


def test_redeem_is_public(magic_link_client):
    """Redemption endpoint must be reachable without an API key (it's the
    whole point — the holder of the link is who's getting access)."""
    resp = magic_link_client.get(
        "/auth/magic-link/totally-bogus-token",
        follow_redirects=False,
    )
    # Bogus token → 404 (constant-shape failure), not 401.
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Generate happy path
# ---------------------------------------------------------------------------


def test_generate_returns_token_and_url(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "scope": "chat"},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["target_username"] == "alice"
    assert data["scope"] == "chat"
    assert data["reusable"] is False
    assert len(data["token"]) >= 32
    assert data["url"].endswith(f"/auth/magic-link/{data['token']}")


def test_generate_with_note_and_reusable(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={
            "target_username": "family",
            "scope": "chat",
            "reusable": True,
            "expires_in": 3600,
            "note": "household share poster",
        },
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["reusable"] is True


def test_generate_respects_public_url_env(magic_link_client, monkeypatch, magic_link_module):
    monkeypatch.setenv("DREAM_PUBLIC_URL", "http://dream.local:3002")
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "bob"},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["url"].startswith("http://dream.local:3002/auth/magic-link/")


# ---------------------------------------------------------------------------
# Generate validation
# ---------------------------------------------------------------------------


def test_generate_rejects_empty_username(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": ""},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 422


def test_generate_rejects_invalid_username_chars(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice; drop table users"},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 422


def test_generate_rejects_invalid_scope(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "scope": "root"},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 422


def test_generate_rejects_short_expiry(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "expires_in": 10},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 422


def test_generate_rejects_long_expiry(magic_link_client):
    resp = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "expires_in": 999_999},
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Redeem happy path
# ---------------------------------------------------------------------------


def test_redeem_sets_cookie_and_redirects(magic_link_client, magic_link_module):
    gen = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "scope": "chat"},
        headers=magic_link_client.auth_headers,
    )
    token = gen.json()["token"]

    resp = magic_link_client.get(
        f"/auth/magic-link/{token}",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    # Session cookie must be HttpOnly.
    set_cookies = [h for h in resp.headers.raw if h[0].lower() == b"set-cookie"]
    cookie_blob = b" ".join(c[1] for c in set_cookies).lower()
    assert b"dream-session=" in cookie_blob
    assert b"httponly" in cookie_blob
    assert b"samesite=lax" in cookie_blob
    # Username hint is readable by the chat UI's JS (not HttpOnly).
    assert b"dream-target-user=alice" in cookie_blob


def test_redeem_marks_token_used(magic_link_client, magic_link_module):
    """Second redemption of a single-use token must 404."""
    gen = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice"},
        headers=magic_link_client.auth_headers,
    )
    token = gen.json()["token"]

    first = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    assert first.status_code == 302

    second = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    assert second.status_code == 404
    assert second.json()["detail"] == "Invalid or expired magic link"


# ---------------------------------------------------------------------------
# Redeem failure modes — all must return the same opaque 404
# ---------------------------------------------------------------------------


def test_redeem_invalid_token(magic_link_client):
    resp = magic_link_client.get(
        "/auth/magic-link/not-a-real-token",
        follow_redirects=False,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Invalid or expired magic link"


def test_redeem_expired_token(magic_link_client, magic_link_module):
    """An expired token returns the same 404 as a bogus one."""
    # Generate with the minimum (60s) expiry, then forcibly age the record.
    gen = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "expires_in": 60},
        headers=magic_link_client.auth_headers,
    )
    token = gen.json()["token"]

    # Reach into storage and rewind expires_at to the past.
    store = magic_link_module._ensure_store()
    assert store["tokens"], "token store must contain the generated record"
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    store["tokens"][0]["expires_at"] = past
    magic_link_module._write_store(store)

    resp = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Invalid or expired magic link"


def test_redeem_revoked_token(magic_link_client, magic_link_module):
    gen = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice"},
        headers=magic_link_client.auth_headers,
    )
    token = gen.json()["token"]

    store = magic_link_module._ensure_store()
    prefix = store["tokens"][0]["token_hash"][:8]

    rev = magic_link_client.delete(
        f"/api/auth/magic-link/{prefix}",
        headers=magic_link_client.auth_headers,
    )
    assert rev.status_code == 200
    assert rev.json()["revoked"] is True

    resp = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Reusable-token semantics
# ---------------------------------------------------------------------------


def test_reusable_token_can_be_redeemed_multiple_times(
    magic_link_client, magic_link_module
):
    gen = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "family", "reusable": True},
        headers=magic_link_client.auth_headers,
    )
    token = gen.json()["token"]

    first = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    second = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    third = magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)

    assert first.status_code == 302
    assert second.status_code == 302
    assert third.status_code == 302

    # Audit trail records every redemption.
    store = magic_link_module._ensure_store()
    redemptions = store["tokens"][0]["redemptions"]
    assert len(redemptions) == 3


# ---------------------------------------------------------------------------
# Rate-limit
# ---------------------------------------------------------------------------


def test_rate_limit_kicks_in_after_repeated_failures(
    magic_link_client, magic_link_module
):
    # 5 failures is the configured ceiling; the 6th must return 429.
    for _ in range(magic_link_module._RATE_LIMIT_MAX_FAILURES):
        bad = magic_link_client.get(
            "/auth/magic-link/no-such-token",
            follow_redirects=False,
        )
        assert bad.status_code == 404

    blocked = magic_link_client.get(
        "/auth/magic-link/no-such-token",
        follow_redirects=False,
    )
    assert blocked.status_code == 429


# ---------------------------------------------------------------------------
# List + revoke
# ---------------------------------------------------------------------------


def test_list_includes_generated_token(magic_link_client):
    magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "note": "for laptop"},
        headers=magic_link_client.auth_headers,
    )
    resp = magic_link_client.get(
        "/api/auth/magic-link/list",
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 200
    tokens = resp.json()["tokens"]
    assert len(tokens) == 1
    assert tokens[0]["target_username"] == "alice"
    assert tokens[0]["note"] == "for laptop"
    assert len(tokens[0]["token_hash_prefix"]) == 8
    assert tokens[0]["redemption_count"] == 0
    assert tokens[0]["revoked_at"] is None


def test_list_reflects_redemption_count(magic_link_client):
    gen = magic_link_client.post(
        "/api/auth/magic-link/generate",
        json={"target_username": "alice", "reusable": True},
        headers=magic_link_client.auth_headers,
    )
    token = gen.json()["token"]

    magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)
    magic_link_client.get(f"/auth/magic-link/{token}", follow_redirects=False)

    resp = magic_link_client.get(
        "/api/auth/magic-link/list",
        headers=magic_link_client.auth_headers,
    )
    tokens = resp.json()["tokens"]
    assert tokens[0]["redemption_count"] == 2
    assert tokens[0]["last_redeemed_at"] is not None


def test_revoke_short_prefix_rejected(magic_link_client):
    resp = magic_link_client.delete(
        "/api/auth/magic-link/abc",
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 400


def test_revoke_unknown_prefix_returns_404(magic_link_client):
    resp = magic_link_client.delete(
        "/api/auth/magic-link/deadbeef",
        headers=magic_link_client.auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# QR endpoint
# ---------------------------------------------------------------------------


def test_qr_endpoint_returns_data_url_when_qrcode_installed(magic_link_client):
    """QR endpoint returns a base64 data URL if the qrcode library is available;
    otherwise 503 with a clear hint. Both shapes are acceptable — the test
    asserts the contract on whichever path is taken."""
    resp = magic_link_client.get(
        "/api/auth/magic-link/qr?url=http://dream.local:3002/auth/magic-link/abc",
        headers=magic_link_client.auth_headers,
    )
    if resp.status_code == 200:
        data = resp.json()
        assert data["data_url"].startswith("data:image/png;base64,")
    else:
        assert resp.status_code == 503
        assert "qrcode" in resp.json()["detail"].lower()
