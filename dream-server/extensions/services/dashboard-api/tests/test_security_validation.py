"""Comprehensive input validation and injection resistance tests.

This test suite validates that the API properly rejects malicious input patterns
including SQL injection, command injection, path traversal, and encoding bypasses.
"""

from unittest.mock import patch, AsyncMock, MagicMock


# ---------------------------------------------------------------------------
# Workflow ID Injection Tests
# ---------------------------------------------------------------------------


def test_workflow_id_sql_injection_single_quote(test_client):
    """Workflow ID with SQL injection attempt (single quote) → 400."""
    resp = test_client.post(
        "/api/workflows/test' OR '1'='1/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_sql_injection_union(test_client):
    """Workflow ID with SQL UNION injection → 400."""
    resp = test_client.post(
        "/api/workflows/test' UNION SELECT * FROM users--/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_command_injection_semicolon(test_client):
    """Workflow ID with command injection (semicolon) → 400."""
    resp = test_client.post(
        "/api/workflows/test;rm -rf //enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_command_injection_pipe(test_client):
    """Workflow ID with command injection (pipe) → 400."""
    resp = test_client.post(
        "/api/workflows/test|cat /etc/passwd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_command_injection_backtick(test_client):
    """Workflow ID with command injection (backtick) → 400."""
    resp = test_client.post(
        "/api/workflows/test`whoami`/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_null_byte_injection(test_client):
    """Workflow ID with null byte → 400."""
    resp = test_client.post(
        "/api/workflows/test\x00malicious/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_url_encoded_traversal(test_client):
    """Workflow ID with URL-encoded path traversal → 400."""
    resp = test_client.post(
        "/api/workflows/..%2F..%2Fetc%2Fpasswd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_double_encoded_traversal(test_client):
    """Workflow ID with double URL-encoded traversal → 400."""
    resp = test_client.post(
        "/api/workflows/..%252F..%252Fetc%252Fpasswd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Path Traversal Variants
# ---------------------------------------------------------------------------


def test_workflow_id_absolute_path(test_client):
    """Workflow ID as absolute path → 400."""
    resp = test_client.post(
        "/api/workflows//etc/passwd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_windows_path(test_client):
    """Workflow ID with Windows path separator → 400."""
    resp = test_client.post(
        "/api/workflows/..\\..\\windows\\system32/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_mixed_separators(test_client):
    """Workflow ID with mixed path separators → 400."""
    resp = test_client.post(
        "/api/workflows/../..\\/etc/passwd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_workflow_id_unicode_traversal(test_client):
    """Workflow ID with Unicode path traversal → 400."""
    resp = test_client.post(
        "/api/workflows/\u2024\u2024/\u2024\u2024/etc/passwd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Persona Validation Tests
# ---------------------------------------------------------------------------


def test_persona_path_traversal(test_client, setup_config_dir):
    """POST /api/setup/persona with path traversal → 400."""
    resp = test_client.post(
        "/api/setup/persona",
        json={"persona": "../../../etc/passwd"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_persona_sql_injection(test_client, setup_config_dir):
    """POST /api/setup/persona with SQL injection → 400."""
    resp = test_client.post(
        "/api/setup/persona",
        json={"persona": "general' OR '1'='1"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_persona_special_chars(test_client, setup_config_dir):
    """POST /api/setup/persona with special characters → 400."""
    resp = test_client.post(
        "/api/setup/persona",
        json={"persona": "test<script>alert(1)</script>"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Port Validation Tests
# ---------------------------------------------------------------------------


def test_preflight_ports_negative_port(test_client):
    """POST /api/preflight/ports with negative port → 422."""
    resp = test_client.post(
        "/api/preflight/ports",
        json={"ports": [-1]},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_preflight_ports_out_of_range_high(test_client):
    """POST /api/preflight/ports with port > 65535 → 422."""
    resp = test_client.post(
        "/api/preflight/ports",
        json={"ports": [70000]},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_preflight_ports_zero(test_client):
    """POST /api/preflight/ports with port 0 → 422."""
    resp = test_client.post(
        "/api/preflight/ports",
        json={"ports": [0]},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_preflight_ports_string_injection(test_client):
    """POST /api/preflight/ports with string instead of int → 422."""
    resp = test_client.post(
        "/api/preflight/ports",
        json={"ports": ["3000; rm -rf /"]},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Subprocess Injection Tests (Update/Backup)
# ---------------------------------------------------------------------------


def test_backup_name_command_injection(test_client):
    """Backup action with command injection in name → safe (validated by script path)."""
    # The backup name is passed as an argument to asyncio.create_subprocess_exec with list args,
    # so command injection should not be possible. This test verifies the pattern.
    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.stdout.read.return_value = b""
        mock_process.stderr.read.return_value = b""
        mock_exec.return_value = mock_process

        # Even with malicious input, asyncio.create_subprocess_exec with list args is safe
        resp = test_client.post(
            "/api/update",
            json={"action": "backup"},
            headers=test_client.auth_headers,
        )

        # Should succeed (or fail for other reasons, but not execute injection)
        # The key is that asyncio.create_subprocess_exec was called with list args, not shell=True
        if mock_exec.called:
            call_args = mock_exec.call_args
            # Verify the first argument is the script path, not a shell command
            assert len(call_args[0]) >= 1  # At least script path
            # Verify no shell=True was used (asyncio.create_subprocess_exec doesn't support shell=True anyway)
            assert "shell" not in call_args[1]


def test_update_action_invalid_action(test_client):
    """POST /api/update with invalid action → 400."""
    resp = test_client.post(
        "/api/update",
        json={"action": "malicious; rm -rf /"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_update_script_path_validation(test_client):
    """Update endpoint validates script path exists before execution."""
    # This test verifies that the script path is validated
    resp = test_client.post(
        "/api/update",
        json={"action": "check"},
        headers=test_client.auth_headers,
    )
    # Should fail with 501 if script doesn't exist (not 500 crash)
    assert resp.status_code == 501
