"""Tests for the AP-mode awareness proxy endpoints in routers/setup.py.

These cover the dashboard-api → host-agent forwarding paths used by the
first-boot wizard when running in AP mode. The actual handoff sequence
(systemctl stop dream-ap-mode + nmcli connect) is tested at the
host-agent layer.

Mocked surfaces:
  * urllib.request.urlopen — stand-in for the host-agent HTTP call.
"""

import json
from unittest.mock import patch, MagicMock

import urllib.error


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


def test_ap_mode_status_requires_auth(test_client):
    resp = test_client.get("/api/setup/ap-mode-status")
    assert resp.status_code == 401


def test_wifi_handoff_requires_auth(test_client):
    resp = test_client.post(
        "/api/setup/wifi-handoff",
        json={"ssid": "x", "password": ""},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_agent_response(body, status=200):
    mock_resp = MagicMock()
    mock_resp.status = status
    mock_resp.read = MagicMock(return_value=json.dumps(body).encode("utf-8"))
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


def _mock_agent_http_error(status, body):
    err = urllib.error.HTTPError(
        url="http://agent/v1/...",
        code=status,
        msg="error",
        hdrs=None,
        fp=None,
    )
    err.read = lambda: json.dumps(body).encode("utf-8")
    return err


# ---------------------------------------------------------------------------
# ap-mode-status
# ---------------------------------------------------------------------------


def test_ap_mode_status_active(test_client):
    upstream = {
        "status": "active",
        "ssid": "Dream-Setup-A4F2",
        "interface": "wlan0",
        "gateway_ip": "192.168.7.1",
        "since": "2026-05-12T08:00:00+00:00",
    }
    with patch("routers.setup.urllib.request.urlopen", return_value=_mock_agent_response(upstream)):
        resp = test_client.get("/api/setup/ap-mode-status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["ssid"] == "Dream-Setup-A4F2"


def test_ap_mode_status_inactive(test_client):
    with patch(
        "routers.setup.urllib.request.urlopen",
        return_value=_mock_agent_response({"status": "inactive"}),
    ):
        resp = test_client.get("/api/setup/ap-mode-status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "inactive"


def test_ap_mode_status_returns_503_when_agent_unreachable(test_client):
    with patch(
        "routers.setup.urllib.request.urlopen",
        side_effect=urllib.error.URLError("connection refused"),
    ):
        resp = test_client.get("/api/setup/ap-mode-status", headers=test_client.auth_headers)
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# wifi-handoff
# ---------------------------------------------------------------------------


def test_wifi_handoff_happy_path(test_client):
    upstream = {
        "status": "scheduled",
        "ssid": "MyHomeWiFi",
        "message": "AP teardown + Wi-Fi connect started; connectivity will drop briefly.",
    }
    with patch(
        "routers.setup.urllib.request.urlopen",
        return_value=_mock_agent_response(upstream, status=202),
    ):
        resp = test_client.post(
            "/api/setup/wifi-handoff",
            json={"ssid": "MyHomeWiFi", "password": "supersecret"},
            headers=test_client.auth_headers,
        )
    # urllib.urlopen treats 2xx as success and reads body normally;
    # FastAPI passes through the body, but the proxy method doesn't
    # forward upstream status — it always returns 200 OK on success.
    # That's fine: the wizard cares about content, not the code.
    assert resp.status_code == 200
    assert resp.json()["status"] == "scheduled"


def test_wifi_handoff_rejects_oversized_ssid(test_client):
    resp = test_client.post(
        "/api/setup/wifi-handoff",
        json={"ssid": "x" * 33, "password": ""},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_wifi_handoff_rejects_oversized_password(test_client):
    resp = test_client.post(
        "/api/setup/wifi-handoff",
        json={"ssid": "ok", "password": "x" * 64},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_wifi_handoff_rejects_control_chars(test_client):
    resp = test_client.post(
        "/api/setup/wifi-handoff",
        json={"ssid": "bad\rssid", "password": ""},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_wifi_handoff_translates_501_when_handoff_not_supported(test_client):
    err = _mock_agent_http_error(501, {"error": "Wi-Fi handoff requires Linux"})
    with patch("routers.setup.urllib.request.urlopen", side_effect=err):
        resp = test_client.post(
            "/api/setup/wifi-handoff",
            json={"ssid": "Home", "password": "secret"},
            headers=test_client.auth_headers,
        )
    assert resp.status_code == 501
    assert "Linux" in resp.json()["detail"]


def test_wifi_handoff_returns_503_when_agent_unreachable(test_client):
    with patch(
        "routers.setup.urllib.request.urlopen",
        side_effect=urllib.error.URLError("connection refused"),
    ):
        resp = test_client.post(
            "/api/setup/wifi-handoff",
            json={"ssid": "Home", "password": "secret"},
            headers=test_client.auth_headers,
        )
    assert resp.status_code == 503
