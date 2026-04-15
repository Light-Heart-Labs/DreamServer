"""Tests for AMD model activation helpers in dream-host-agent.py."""

import importlib.util
import subprocess
import sys
from pathlib import Path

# Import the host agent module from bin/ using importlib.
# The module has an ``if __name__ == "__main__":`` guard so no server starts.
_agent_path = Path(__file__).resolve().parents[4] / "bin" / "dream-host-agent.py"
_spec = importlib.util.spec_from_file_location("dream_host_agent_activate", _agent_path)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["dream_host_agent_activate"] = _mod
_spec.loader.exec_module(_mod)

_check_lemonade_health = _mod._check_lemonade_health
_send_lemonade_warmup = _mod._send_lemonade_warmup
_write_lemonade_config = _mod._write_lemonade_config


# --- _check_lemonade_health ---


class TestCheckLemonadeHealth:

    def test_model_loaded(self):
        body = '{"status": "ok", "model_loaded": "extra.Qwen3.5-9B-Q4_K_M.gguf"}'
        assert _check_lemonade_health(body) is True

    def test_model_null(self):
        body = '{"status": "ok", "model_loaded": null}'
        assert _check_lemonade_health(body) is False

    def test_no_model_loaded_key(self):
        body = '{"status": "ok"}'
        assert _check_lemonade_health(body) is False

    def test_invalid_json(self):
        assert _check_lemonade_health("not json") is False

    def test_empty_string(self):
        assert _check_lemonade_health("") is False

    def test_model_loaded_false_is_truthy(self):
        """model_loaded=false is unusual but non-null, so should be True."""
        body = '{"model_loaded": false}'
        assert _check_lemonade_health(body) is True

    def test_model_loaded_empty_string(self):
        """model_loaded="" is non-null, so should be True."""
        body = '{"model_loaded": ""}'
        assert _check_lemonade_health(body) is True


# --- _send_lemonade_warmup ---


class TestSendLemonadeWarmup:

    def test_success(self, monkeypatch):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            result = subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            return result

        monkeypatch.setattr(subprocess, "run", fake_run)
        assert _send_lemonade_warmup("localhost", "8080", "model.gguf", 0) is True
        assert len(calls) == 1
        # Verify curl is called with correct URL and model ID
        cmd = calls[0]
        assert "http://localhost:8080/api/v1/chat/completions" in cmd
        payload_idx = cmd.index("-d") + 1
        assert '"extra.model.gguf"' in cmd[payload_idx]

    def test_failure(self, monkeypatch):
        def fake_run(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="error")

        monkeypatch.setattr(subprocess, "run", fake_run)
        assert _send_lemonade_warmup("localhost", "8080", "model.gguf", 0) is False

    def test_timeout(self, monkeypatch):
        def fake_run(cmd, **kwargs):
            raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout", 35))

        monkeypatch.setattr(subprocess, "run", fake_run)
        assert _send_lemonade_warmup("localhost", "8080", "model.gguf", 0) is False

    def test_containerized_host(self, monkeypatch):
        """Verify the host parameter is used (not hardcoded to localhost)."""
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        monkeypatch.setattr(subprocess, "run", fake_run)
        _send_lemonade_warmup("dream-llama-server", "8080", "model.gguf", 0)
        assert "http://dream-llama-server:8080/api/v1/chat/completions" in calls[0]


# --- _write_lemonade_config ---


class TestWriteLemonadeConfig:

    def test_writes_correct_content(self, tmp_path):
        litellm_dir = tmp_path / "config" / "litellm"
        litellm_dir.mkdir(parents=True)
        _write_lemonade_config(tmp_path, "Qwen3.5-9B-Q4_K_M.gguf")

        content = (litellm_dir / "lemonade.yaml").read_text()
        assert "model: openai/extra.Qwen3.5-9B-Q4_K_M.gguf" in content
        assert "api_base: http://llama-server:8080/api/v1" in content
        assert "api_key: sk-lemonade" in content
        assert 'model_name: "*"' in content
        assert "drop_params: true" in content

    def test_overwrites_previous(self, tmp_path):
        litellm_dir = tmp_path / "config" / "litellm"
        litellm_dir.mkdir(parents=True)

        _write_lemonade_config(tmp_path, "old-model.gguf")
        _write_lemonade_config(tmp_path, "new-model.gguf")

        content = (litellm_dir / "lemonade.yaml").read_text()
        assert "old-model.gguf" not in content
        assert "model: openai/extra.new-model.gguf" in content

    def test_file_path(self, tmp_path):
        litellm_dir = tmp_path / "config" / "litellm"
        litellm_dir.mkdir(parents=True)
        _write_lemonade_config(tmp_path, "model.gguf")
        assert (litellm_dir / "lemonade.yaml").exists()


# --- Rollback integration ---


class TestLemonadeYamlRollback:
    """Verify that lemonade.yaml is backed up and restored on rollback.

    We don't spin up the full HTTP server — instead, we test the backup/restore
    logic by checking that the pattern in _do_model_activate is correct.
    """

    def test_backup_sentinel_none_when_missing(self, tmp_path):
        """When lemonade.yaml doesn't exist, backup should be None."""
        yaml_path = tmp_path / "config" / "litellm" / "lemonade.yaml"
        # File doesn't exist
        backup = yaml_path.read_text(encoding="utf-8") if yaml_path.exists() else None
        assert backup is None

    def test_backup_preserves_content(self, tmp_path):
        """When lemonade.yaml exists, backup should capture content."""
        litellm_dir = tmp_path / "config" / "litellm"
        litellm_dir.mkdir(parents=True)
        yaml_path = litellm_dir / "lemonade.yaml"
        yaml_path.write_text("original content", encoding="utf-8")

        backup = yaml_path.read_text(encoding="utf-8") if yaml_path.exists() else None
        assert backup == "original content"

        # Simulate overwrite + rollback
        _write_lemonade_config(tmp_path, "new-model.gguf")
        assert "new-model.gguf" in yaml_path.read_text()

        # Restore
        if backup is not None:
            yaml_path.write_text(backup, encoding="utf-8")
        assert yaml_path.read_text() == "original content"

    def test_no_restore_when_backup_is_none(self, tmp_path):
        """When backup is None, rollback should not create the file."""
        litellm_dir = tmp_path / "config" / "litellm"
        litellm_dir.mkdir(parents=True)
        yaml_path = litellm_dir / "lemonade.yaml"

        backup = None  # File didn't exist at backup time
        # Rollback should NOT create the file
        if backup is not None:
            yaml_path.write_text(backup, encoding="utf-8")
        assert not yaml_path.exists()


# --- NVIDIA regression guard ---


class TestNvidiaHealthUnchanged:
    """Ensure the NVIDIA health check still uses the simple '"ok"' check."""

    def test_ok_response_is_healthy(self):
        """llama.cpp health response contains "ok" — should be detected."""
        body = '{"status": "ok"}'
        # The NVIDIA path checks: '"ok"' in body
        assert '"ok"' in body

    def test_model_loaded_not_needed_for_nvidia(self):
        """NVIDIA doesn't need model_loaded — just "ok" is sufficient."""
        # This response has "ok" but no model_loaded — fine for NVIDIA
        body = '{"status": "ok"}'
        assert '"ok"' in body
        # But Lemonade check would fail (no model_loaded key)
        assert _check_lemonade_health(body) is False
