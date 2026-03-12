"""Tests for helpers.py — model info, bootstrap status, token tracking, system metrics."""

import json


from helpers import (
    get_model_info, get_bootstrap_status, _update_lifetime_tokens,
    get_uptime, get_cpu_metrics, get_ram_metrics,
)
from models import BootstrapStatus


# --- get_model_info ---


class TestGetModelInfo:

    def test_parses_32b_awq_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Qwen2.5-32B-Instruct-AWQ\n')

        info = get_model_info()
        assert info is not None
        assert info.name == "Qwen2.5-32B-Instruct-AWQ"
        assert info.size_gb == 16.0
        assert info.quantization == "AWQ"

    def test_parses_7b_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Qwen2.5-7B-Instruct\n')

        info = get_model_info()
        assert info is not None
        assert info.size_gb == 4.0
        assert info.quantization is None

    def test_parses_14b_gptq_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Qwen2.5-14B-Instruct-GPTQ\n')

        info = get_model_info()
        assert info is not None
        assert info.size_gb == 8.0
        assert info.quantization == "GPTQ"

    def test_parses_70b_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Llama-3-70B-GGUF\n')

        info = get_model_info()
        assert info is not None
        assert info.size_gb == 35.0
        assert info.quantization == "GGUF"

    def test_returns_none_when_no_env(self, install_dir):
        # No .env file created
        assert get_model_info() is None

    def test_returns_none_when_no_llm_model_line(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('SOME_OTHER_VAR=foo\n')

        assert get_model_info() is None

    def test_handles_quoted_value(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL="Qwen2.5-7B-Instruct"\n')

        info = get_model_info()
        assert info is not None
        assert info.name == "Qwen2.5-7B-Instruct"


# --- get_bootstrap_status ---


class TestGetBootstrapStatus:

    def test_inactive_when_no_file(self, data_dir):
        status = get_bootstrap_status()
        assert isinstance(status, BootstrapStatus)
        assert status.active is False

    def test_inactive_when_complete(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({"status": "complete"}))

        status = get_bootstrap_status()
        assert status.active is False

    def test_inactive_when_empty_status(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({"status": ""}))

        status = get_bootstrap_status()
        assert status.active is False

    def test_active_download(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({
            "status": "downloading",
            "model": "Qwen2.5-32B",
            "percent": 42.5,
            "bytesDownloaded": 5 * 1024**3,
            "bytesTotal": 12 * 1024**3,
            "speedBytesPerSec": 50 * 1024**2,
            "eta": "3m 20s",
        }))

        status = get_bootstrap_status()
        assert status.active is True
        assert status.model_name == "Qwen2.5-32B"
        assert status.percent == 42.5
        assert status.eta_seconds == 200  # 3*60 + 20

    def test_eta_calculating(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({
            "status": "downloading",
            "percent": 1.0,
            "eta": "calculating...",
        }))

        status = get_bootstrap_status()
        assert status.active is True
        assert status.eta_seconds is None

    def test_handles_malformed_json(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text("not json!")

        status = get_bootstrap_status()
        assert status.active is False


# --- _update_lifetime_tokens ---


class TestUpdateLifetimeTokens:

    def test_fresh_start(self, data_dir):
        result = _update_lifetime_tokens(100.0)
        assert result == 100

    def test_accumulates_across_calls(self, data_dir):
        _update_lifetime_tokens(100.0)
        result = _update_lifetime_tokens(250.0)
        assert result == 250  # 100 + (250 - 100)

    def test_handles_server_restart(self, data_dir):
        """When server_counter < prev, the counter has reset."""
        _update_lifetime_tokens(500.0)
        # Server restarted, counter back to 50
        result = _update_lifetime_tokens(50.0)
        # Should add 50 (treats reset counter as fresh delta)
        assert result == 550  # 500 + 50

    def test_handles_corrupted_token_file(self, data_dir):
        """Corrupted JSON should log a warning and start fresh."""
        token_file = data_dir / "token_counter.json"
        token_file.write_text("not valid json{{{")
        result = _update_lifetime_tokens(100.0)
        assert result == 100

    def test_handles_unwritable_token_file(self, data_dir, monkeypatch):
        """When the token file cannot be written, should not raise."""
        import helpers
        monkeypatch.setattr(helpers, "_TOKEN_FILE", data_dir / "readonly" / "token.json")
        # Parent dir doesn't exist, so write will fail
        result = _update_lifetime_tokens(50.0)
        assert result == 50


# --- System metrics (cross-platform) ---


class TestGetUptime:

    def test_returns_int(self):
        result = get_uptime()
        assert isinstance(result, int)
        assert result >= 0

    def test_returns_zero_on_unsupported_platform(self, monkeypatch):
        monkeypatch.setattr("helpers.platform.system", lambda: "UnknownOS")
        assert get_uptime() == 0


class TestGetCpuMetrics:

    def test_returns_expected_keys(self):
        result = get_cpu_metrics()
        assert "percent" in result
        assert "temp_c" in result
        assert isinstance(result["percent"], (int, float))

    def test_returns_defaults_on_unsupported_platform(self, monkeypatch):
        monkeypatch.setattr("helpers.platform.system", lambda: "UnknownOS")
        result = get_cpu_metrics()
        assert result == {"percent": 0, "temp_c": None}


class TestGetRamMetrics:

    def test_returns_expected_keys(self):
        result = get_ram_metrics()
        assert "used_gb" in result
        assert "total_gb" in result
        assert "percent" in result

    def test_returns_defaults_on_unsupported_platform(self, monkeypatch):
        monkeypatch.setattr("helpers.platform.system", lambda: "UnknownOS")
        result = get_ram_metrics()
        assert result == {"used_gb": 0, "total_gb": 0, "percent": 0}
