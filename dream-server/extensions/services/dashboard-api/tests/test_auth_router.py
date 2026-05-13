"""Tests for routers/auth.py — /api/auth/verify-session.

The endpoint is consumed by Caddy reverse proxies via ``forward_auth``.
It validates the dream-session cookie via session_signer and returns
200/401 based on signature + expiry.
"""

import pytest

import session_signer


@pytest.fixture(autouse=True)
def _set_secret():
    """Install a known signing secret for each test."""
    session_signer._set_secret_for_tests("test-secret-for-verify-endpoint")
    yield
    session_signer._set_secret_for_tests("")


def test_no_cookie_returns_401(test_client):
    """Caddy forward_auth sends the request with no dream-session at all."""
    resp = test_client.get("/api/auth/verify-session")
    assert resp.status_code == 401


def test_empty_cookie_returns_401(test_client):
    """Empty string is malformed, not a valid signature."""
    test_client.cookies.set("dream-session", "")
    resp = test_client.get("/api/auth/verify-session")
    assert resp.status_code == 401
    test_client.cookies.clear()


def test_valid_cookie_returns_200(test_client):
    cookie = session_signer.issue(ttl_seconds=60)
    test_client.cookies.set("dream-session", cookie)
    try:
        resp = test_client.get("/api/auth/verify-session")
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is True
        assert isinstance(body["expires_at"], int)
        assert body["expires_at"] > 0
    finally:
        test_client.cookies.clear()


def test_tampered_signature_returns_401(test_client):
    cookie = session_signer.issue(ttl_seconds=60)
    random_id, expiry, _ = cookie.split(".")
    tampered = f"{random_id}.{expiry}.fakesignature"
    test_client.cookies.set("dream-session", tampered)
    try:
        resp = test_client.get("/api/auth/verify-session")
        assert resp.status_code == 401
    finally:
        test_client.cookies.clear()


def test_expired_cookie_returns_401(test_client):
    """Sign a cookie with a past expiry. Caddy will get a 401 and refuse
    to forward to the upstream."""
    import time
    random_id = "abc"
    past_expiry = int(time.time()) - 60
    payload = f"{random_id}.{past_expiry}"
    sig = session_signer._sign(payload)
    cookie = f"{payload}.{sig}"
    test_client.cookies.set("dream-session", cookie)
    try:
        resp = test_client.get("/api/auth/verify-session")
        assert resp.status_code == 401
    finally:
        test_client.cookies.clear()


def test_endpoint_does_not_require_dashboard_api_key(test_client):
    """The endpoint is reachable from any reverse proxy on the bridge
    network without the dashboard's Bearer API key — Caddy can't easily
    inject that header through forward_auth, and the cookie ITSELF is
    the credential being validated. Confirms no auth dependency was
    accidentally added."""
    cookie = session_signer.issue(ttl_seconds=60)
    test_client.cookies.set("dream-session", cookie)
    try:
        # No auth_headers — bare request, only the cookie.
        resp = test_client.get("/api/auth/verify-session")
        assert resp.status_code == 200
    finally:
        test_client.cookies.clear()


def test_error_response_is_the_same_regardless_of_reason(test_client):
    """The 401 response body must be identical for every failure mode —
    if an attacker can distinguish "bad signature" from "expired" from
    "malformed", they can probe to learn something useful (e.g. whether
    a specific cookie format is server-issued vs. random). Generic
    response shape across all failures defeats that.
    """
    import time

    # Pre-build cookies for each rejection reason.
    bad_sig = "abc.99999999999.tampered"
    past_expiry = int(time.time()) - 60
    payload = f"abc.{past_expiry}"
    sig = session_signer._sign(payload)
    expired_cookie = f"{payload}.{sig}"
    malformed = "only-one-piece"

    bodies = []
    for cookie_value in [bad_sig, expired_cookie, malformed, ""]:
        if cookie_value:
            test_client.cookies.set("dream-session", cookie_value)
        else:
            test_client.cookies.clear()
        resp = test_client.get("/api/auth/verify-session")
        assert resp.status_code == 401
        bodies.append(resp.json())
        test_client.cookies.clear()

    # All four 401 responses must be byte-identical so an attacker can't
    # tell which failure path they hit.
    assert all(b == bodies[0] for b in bodies), (
        f"401 bodies differ across rejection reasons: {bodies!r}"
    )
    # Response should also not contain any internal session_signer reason
    # strings like "bad-signature", "no-secret", "malformed" — those are
    # implementation details. (We use "Invalid or expired session" which
    # is intentionally vague.)
    body_str = str(bodies[0])
    for leak in ("bad-signature", "no-secret", "malformed"):
        assert leak not in body_str, f"reason leaked: {leak!r} in {body_str!r}"
