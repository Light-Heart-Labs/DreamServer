"""Tests for the dashboard setup wizard state contract."""

from __future__ import annotations


def test_setup_wizard_defaults(test_client, setup_config_dir):
    """GET /api/setup/wizard returns sensible defaults on a clean install."""
    resp = test_client.get("/api/setup/wizard", headers=test_client.auth_headers)
    assert resp.status_code == 200

    data = resp.json()
    assert data["firstRun"] is True
    assert data["completed"] is False
    assert data["step"] == 1
    assert data["config"]["voice"] == "af_heart"
    assert data["config"]["tested"] is False
    assert len(data["voices"]) >= 5


def test_setup_wizard_persists_state(test_client, setup_config_dir):
    """POST /api/setup/wizard saves the current dashboard wizard state."""
    resp = test_client.post(
        "/api/setup/wizard",
        json={
            "step": 4,
            "user_name": "Taylor",
            "voice": "am_michael",
            "tested": True,
            "preflight_passed": True,
            "preflight_issues": ["Port 3000 already in use"],
        },
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200

    data = resp.json()
    assert data["success"] is True
    assert data["step"] == 4
    assert data["config"]["userName"] == "Taylor"
    assert data["config"]["voice"] == "am_michael"
    assert data["config"]["tested"] is True
    assert data["config"]["preflightPassed"] is True
    assert data["config"]["preflightIssues"] == ["Port 3000 already in use"]

    wizard_file = setup_config_dir / "wizard-state.json"
    assert wizard_file.exists()
    assert '"voice": "am_michael"' in wizard_file.read_text()


def test_setup_status_uses_wizard_step(test_client, setup_config_dir):
    """GET /api/setup/status reflects the persisted wizard step."""
    (setup_config_dir / "wizard-state.json").write_text(
        """
{
  "step": 3,
  "user_name": "Taylor",
  "voice": "af_sky",
  "tested": false,
  "preflight_passed": true,
  "preflight_issues": []
}
""".strip()
    )

    resp = test_client.get("/api/setup/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert resp.json()["step"] == 3


def test_setup_complete_marks_wizard_finished(test_client, setup_config_dir):
    """POST /api/setup/complete keeps wizard state aligned with completion."""
    (setup_config_dir / "wizard-state.json").write_text(
        """
{
  "step": 2,
  "user_name": "Taylor",
  "voice": "af_heart",
  "tested": false,
  "preflight_passed": true,
  "preflight_issues": []
}
""".strip()
    )

    resp = test_client.post("/api/setup/complete", headers=test_client.auth_headers)
    assert resp.status_code == 200

    wizard_resp = test_client.get("/api/setup/wizard", headers=test_client.auth_headers)
    assert wizard_resp.status_code == 200
    data = wizard_resp.json()
    assert data["firstRun"] is False
    assert data["completed"] is True
    assert data["step"] == 5
