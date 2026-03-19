from __future__ import annotations
import json
from pathlib import Path
import pytest

_SECRET_KEYS = frozenset({
    "WEBUI_SECRET", "N8N_PASS", "LITELLM_KEY", "OPENCLAW_TOKEN",
    "QDRANT_API_KEY", "TOKEN_SPY_API_KEY", "DASHBOARD_API_KEY",
    "OPENCODE_SERVER_PASSWORD", "LIVEKIT_API_SECRET", "DIFY_SECRET_KEY",
})


@pytest.fixture()
def env_file(tmp_path):
    f = tmp_path / ".env"
    f.write_text(
        chr(10).join([
            "# Dream Server config",
            "LLM_MODEL=qwen3-8b",
            "DREAM_MODE=local",
            "TIER=T2",
            "GPU_BACKEND=nvidia",
            "DREAM_VERSION=2.1.0",
            "WHISPER_MODEL=base",
            "TTS_VOICE=af_sky",
            "WHISPER_VAD_THRESHOLD=0.5",
            "WEBUI_SECRET=super-secret-webui",
            "LITELLM_KEY=sk-litellm-secret",
            "OPENCLAW_TOKEN=tok-secret-claw",
            "",
        ]),
        encoding="utf-8",
    )
    return f


@pytest.fixture()
def schema_file(tmp_path):
    schema = {
        "type": "object",
        "properties": {
            "DREAM_MODE": {"type": "string", "enum": ["local", "cloud", "hybrid"], "default": "local"},
            "LLM_MODEL": {"type": "string"},
            "TIER": {"type": "string"},
            "GPU_BACKEND": {"type": "string", "default": "nvidia"},
            "DREAM_VERSION": {"type": "string"},
            "WHISPER_MODEL": {
                "type": "string",
                "enum": ["tiny","tiny.en","base","base.en","small","small.en",
                         "medium","medium.en","large","large-v2","large-v3","large-v3-turbo"],
                "default": "base",
            },
            "WHISPER_VAD_THRESHOLD": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.5},
            "TTS_VOICE": {"type": "string"},
            "QDRANT_PORT": {"type": "integer"},
            "EMBEDDING_MODEL": {"type": "string"},
            "WEBUI_SECRET":      {"type": "string", "secret": True},
            "LITELLM_KEY":       {"type": "string", "secret": True},
            "OPENCLAW_TOKEN":    {"type": "string", "secret": True},
            "QDRANT_API_KEY":    {"type": "string", "secret": True},
            "DASHBOARD_API_KEY": {"type": "string", "secret": True},
        },
    }
    f = tmp_path / ".env.schema.json"
    f.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    return f


@pytest.fixture()
def patched_env_utils(env_file, schema_file, monkeypatch):
    import env_utils
    monkeypatch.setattr(env_utils, "_ENV_PATH", env_file)
    monkeypatch.setattr(env_utils, "_SCHEMA_PATH", schema_file)
    return env_utils


@pytest.fixture()
def fake_cli(tmp_path):
    cli = tmp_path / "dream-cli"
    cli.write_text(chr(10).join(["#!/bin/bash", "echo Model set", "exit 0", ""]))
    cli.chmod(0o755)
    return cli
# ---------------------------------------------------------------------------
# env_utils -- unit tests
# ---------------------------------------------------------------------------

class TestReadEnv:
    def test_reads_simple_key(self, patched_env_utils):
        assert patched_env_utils.read_env()["LLM_MODEL"] == "qwen3-8b"

    def test_skips_comments(self, patched_env_utils):
        assert not any(k.startswith("#") for k in patched_env_utils.read_env())

    def test_strips_double_quotes(self, env_file, patched_env_utils):
        env_file.write_text("KEY=" + chr(34) + "quoted value" + chr(34) + chr(10), encoding="utf-8")
        assert patched_env_utils.read_env()["KEY"] == "quoted value"

    def test_strips_single_quotes(self, env_file, patched_env_utils):
        sq = chr(39)
        env_file.write_text("KEY=" + sq + "single quoted" + sq + chr(10), encoding="utf-8")
        assert patched_env_utils.read_env()["KEY"] == "single quoted"

    def test_missing_file_returns_empty(self, tmp_path, monkeypatch):
        import env_utils
        monkeypatch.setattr(env_utils, "_ENV_PATH", tmp_path / "nonexistent.env")
        assert env_utils.read_env() == {}

    def test_skips_malformed_lines(self, env_file, patched_env_utils):
        env_file.write_text(chr(10).join(["GOOD=yes", "===bad", "ALSO_GOOD=yes", ""]), encoding="utf-8")
        env = patched_env_utils.read_env()
        assert "GOOD" in env and "ALSO_GOOD" in env and "===bad" not in env

    def test_all_expected_keys_parsed(self, patched_env_utils):
        env = patched_env_utils.read_env()
        for k in ("LLM_MODEL", "DREAM_MODE", "TIER", "GPU_BACKEND", "WHISPER_MODEL"):
            assert k in env


class TestWriteEnvKey:
    def test_updates_existing_key(self, env_file, patched_env_utils):
        patched_env_utils.write_env_key("LLM_MODEL", "qwen3-14b")
        text = env_file.read_text(encoding="utf-8")
        assert "LLM_MODEL=qwen3-14b" in text and "LLM_MODEL=qwen3-8b" not in text

    def test_appends_new_key(self, env_file, patched_env_utils):
        patched_env_utils.write_env_key("NEW_KEY", "new_value")
        assert "NEW_KEY=new_value" in env_file.read_text(encoding="utf-8")

    def test_updates_only_first_occurrence(self, env_file, patched_env_utils):
        env_file.write_text(chr(10).join(["KEY=first", "KEY=second", ""]), encoding="utf-8")
        patched_env_utils.write_env_key("KEY", "updated")
        text = env_file.read_text(encoding="utf-8")
        assert text.count("KEY=updated") == 1 and "KEY=second" in text

    def test_preserves_other_keys(self, env_file, patched_env_utils):
        patched_env_utils.write_env_key("DREAM_MODE", "cloud")
        assert patched_env_utils.read_env()["LLM_MODEL"] == "qwen3-8b"

    def test_missing_env_file_logs_warning(self, tmp_path, monkeypatch, caplog):
        import env_utils, logging
        monkeypatch.setattr(env_utils, "_ENV_PATH", tmp_path / "nonexistent.env")
        with caplog.at_level(logging.WARNING, logger="env_utils"):
            env_utils.write_env_key("KEY", "val")
        assert caplog.text


class TestValidateAgainstSchema:
    def test_valid_enum_value(self, patched_env_utils):
        schema = patched_env_utils.load_schema()
        assert patched_env_utils.validate_against_schema(
            "whisper_model", "WHISPER_MODEL", "small", schema) is None

    def test_invalid_enum_value(self, patched_env_utils):
        schema = patched_env_utils.load_schema()
        err = patched_env_utils.validate_against_schema(
            "whisper_model", "WHISPER_MODEL", "giant", schema)
        assert err is not None and "must be one of" in err

    def test_number_within_bounds(self, patched_env_utils):
        schema = patched_env_utils.load_schema()
        assert patched_env_utils.validate_against_schema(
            "vad", "WHISPER_VAD_THRESHOLD", 0.7, schema) is None

    def test_number_below_minimum(self, patched_env_utils):
        schema = patched_env_utils.load_schema()
        err = patched_env_utils.validate_against_schema(
            "vad", "WHISPER_VAD_THRESHOLD", -0.1, schema)
        assert err is not None and ">=" in err

    def test_number_above_maximum(self, patched_env_utils):
        schema = patched_env_utils.load_schema()
        err = patched_env_utils.validate_against_schema(
            "vad", "WHISPER_VAD_THRESHOLD", 1.5, schema)
        assert err is not None and "<=" in err

    def test_unknown_key_allows_any(self, patched_env_utils):
        schema = patched_env_utils.load_schema()
        assert patched_env_utils.validate_against_schema(
            "x", "NO_SUCH_KEY", "v", schema) is None

    def test_empty_schema_allows_any(self, patched_env_utils):
        assert patched_env_utils.validate_against_schema("f", "K", "v", {}) is None
# ---------------------------------------------------------------------------
# GET /api/settings
# ---------------------------------------------------------------------------

class TestGetSettings:
    def test_returns_200(self, test_client, patched_env_utils):
        assert test_client.get("/api/settings", headers=test_client.auth_headers).status_code == 200

    def test_requires_auth(self, test_client):
        assert test_client.get("/api/settings").status_code == 401

    def test_returns_required_fields(self, test_client, patched_env_utils):
        data = test_client.get("/api/settings", headers=test_client.auth_headers).json()
        for field in ("llm_model","mode","tier","gpu_backend","enabled_services","voice_enabled","rag_enabled"):
            assert field in data, f"Field {field!r} missing"

    def test_reads_values_from_env(self, test_client, patched_env_utils):
        data = test_client.get("/api/settings", headers=test_client.auth_headers).json()
        assert data["llm_model"] == "qwen3-8b"
        assert data["mode"] == "local"
        assert data["tier"] == "T2"
        assert data["gpu_backend"] == "nvidia"

    def test_secret_values_not_in_body(self, test_client, patched_env_utils):
        raw = test_client.get("/api/settings", headers=test_client.auth_headers).text
        assert "super-secret-webui" not in raw
        assert "sk-litellm-secret" not in raw
        assert "tok-secret-claw" not in raw

    def test_secret_key_names_absent_from_response(self, test_client, patched_env_utils):
        data = test_client.get("/api/settings", headers=test_client.auth_headers).json()
        keys_lower = {k.lower() for k in data}
        for secret in _SECRET_KEYS:
            assert secret.lower() not in keys_lower, f"Secret {secret!r} leaked"

    def test_voice_enabled_true_when_whisper_model_set(self, test_client, patched_env_utils):
        assert test_client.get("/api/settings", headers=test_client.auth_headers).json()["voice_enabled"] is True

    def test_voice_enabled_false_when_no_voice_keys(self, test_client, env_file, patched_env_utils):
        env_file.write_text(chr(10).join(["LLM_MODEL=qwen3-8b", "DREAM_MODE=local", ""]), encoding="utf-8")
        assert test_client.get("/api/settings", headers=test_client.auth_headers).json()["voice_enabled"] is False

    def test_enabled_services_is_list(self, test_client, patched_env_utils):
        assert isinstance(
            test_client.get("/api/settings", headers=test_client.auth_headers).json()["enabled_services"], list)


# ---------------------------------------------------------------------------
# PATCH /api/settings
# ---------------------------------------------------------------------------

class TestPatchSettings:
    def test_updates_llm_model(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings", json={"llm_model": "qwen3-14b"}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "LLM_MODEL=qwen3-14b" in env_file.read_text(encoding="utf-8")

    def test_updates_mode(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings", json={"mode": "cloud"}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "DREAM_MODE=cloud" in env_file.read_text(encoding="utf-8")

    def test_invalid_mode_returns_422(self, test_client, patched_env_utils):
        assert test_client.patch("/api/settings", json={"mode": "turbo"}, headers=test_client.auth_headers).status_code == 422

    def test_blank_llm_model_returns_422(self, test_client, patched_env_utils):
        assert test_client.patch("/api/settings", json={"llm_model": "   "}, headers=test_client.auth_headers).status_code == 422

    def test_multiple_errors_returned_together(self, test_client, patched_env_utils):
        resp = test_client.patch("/api/settings", json={"mode": "bad", "llm_model": ""}, headers=test_client.auth_headers)
        assert resp.status_code == 422 and len(resp.json()["detail"]) >= 2

    def test_no_partial_write_on_error(self, test_client, patched_env_utils, env_file):
        original = env_file.read_text(encoding="utf-8")
        test_client.patch("/api/settings", json={"mode": "bad-mode", "llm_model": "qwen3-14b"}, headers=test_client.auth_headers)
        assert env_file.read_text(encoding="utf-8") == original

    def test_response_reflects_new_value(self, test_client, patched_env_utils):
        resp = test_client.patch("/api/settings", json={"mode": "hybrid"}, headers=test_client.auth_headers)
        assert resp.status_code == 200 and resp.json()["mode"] == "hybrid"

    def test_requires_auth(self, test_client):
        assert test_client.patch("/api/settings", json={"mode": "local"}).status_code == 401
# ---------------------------------------------------------------------------
# GET /api/settings/voice
# ---------------------------------------------------------------------------

class TestGetVoiceSettings:
    def test_returns_200(self, test_client, patched_env_utils):
        assert test_client.get("/api/settings/voice", headers=test_client.auth_headers).status_code == 200

    def test_requires_auth(self, test_client):
        assert test_client.get("/api/settings/voice").status_code == 401

    def test_returns_required_fields(self, test_client, patched_env_utils):
        data = test_client.get("/api/settings/voice", headers=test_client.auth_headers).json()
        for f in ("whisper_model", "whisper_vad_threshold", "allowed_whisper_models"):
            assert f in data

    def test_reads_values_from_env(self, test_client, patched_env_utils):
        data = test_client.get("/api/settings/voice", headers=test_client.auth_headers).json()
        assert data["whisper_model"] == "base"
        assert data["tts_voice"] == "af_sky"
        assert data["whisper_vad_threshold"] == pytest.approx(0.5)

    def test_defaults_when_keys_absent(self, test_client, env_file, patched_env_utils):
        env_file.write_text(chr(10).join(["LLM_MODEL=qwen3-8b", ""]), encoding="utf-8")
        data = test_client.get("/api/settings/voice", headers=test_client.auth_headers).json()
        assert data["whisper_model"] == "base"
        assert data["whisper_vad_threshold"] == pytest.approx(0.5)
        assert data["tts_voice"] is None

    def test_allowed_whisper_models_from_schema(self, test_client, patched_env_utils):
        models = test_client.get("/api/settings/voice", headers=test_client.auth_headers).json()["allowed_whisper_models"]
        assert isinstance(models, list) and len(models) > 0
        assert "base" in models and "large-v3" in models


# ---------------------------------------------------------------------------
# PATCH /api/settings/voice
# ---------------------------------------------------------------------------

class TestPatchVoiceSettings:
    def test_updates_whisper_model(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings/voice", json={"whisper_model": "small"}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "WHISPER_MODEL=small" in env_file.read_text(encoding="utf-8")

    def test_updates_tts_voice(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings/voice", json={"tts_voice": "bf_emma"}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "TTS_VOICE=bf_emma" in env_file.read_text(encoding="utf-8")

    def test_updates_vad_threshold(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings/voice", json={"whisper_vad_threshold": 0.7}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "WHISPER_VAD_THRESHOLD=0.7" in env_file.read_text(encoding="utf-8")

    def test_invalid_whisper_model_returns_422(self, test_client, patched_env_utils):
        resp = test_client.patch("/api/settings/voice", json={"whisper_model": "giant"}, headers=test_client.auth_headers)
        assert resp.status_code == 422
        assert any("must be one of" in str(e) for e in resp.json()["detail"])

    def test_blank_tts_voice_returns_422(self, test_client, patched_env_utils):
        assert test_client.patch("/api/settings/voice", json={"tts_voice": "   "}, headers=test_client.auth_headers).status_code == 422

    def test_vad_above_1_returns_422(self, test_client, patched_env_utils):
        assert test_client.patch("/api/settings/voice", json={"whisper_vad_threshold": 1.5}, headers=test_client.auth_headers).status_code == 422

    def test_vad_below_0_returns_422(self, test_client, patched_env_utils):
        assert test_client.patch("/api/settings/voice", json={"whisper_vad_threshold": -0.1}, headers=test_client.auth_headers).status_code == 422

    def test_vad_boundary_0_accepted(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings/voice", json={"whisper_vad_threshold": 0.0}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "WHISPER_VAD_THRESHOLD=0.0" in env_file.read_text(encoding="utf-8")

    def test_vad_boundary_1_accepted(self, test_client, patched_env_utils):
        assert test_client.patch("/api/settings/voice", json={"whisper_vad_threshold": 1.0}, headers=test_client.auth_headers).status_code == 200

    def test_no_partial_write_on_validation_error(self, test_client, patched_env_utils, env_file):
        original = env_file.read_text(encoding="utf-8")
        test_client.patch("/api/settings/voice", json={"whisper_model": "invalid-model", "tts_voice": "bf_emma"}, headers=test_client.auth_headers)
        assert env_file.read_text(encoding="utf-8") == original

    def test_response_reflects_updated_value(self, test_client, patched_env_utils):
        resp = test_client.patch("/api/settings/voice", json={"whisper_model": "medium"}, headers=test_client.auth_headers)
        assert resp.status_code == 200 and resp.json()["whisper_model"] == "medium"

    def test_multiple_fields_updated_atomically(self, test_client, patched_env_utils, env_file):
        resp = test_client.patch("/api/settings/voice", json={"whisper_model": "large", "whisper_vad_threshold": 0.3}, headers=test_client.auth_headers)
        assert resp.status_code == 200
        text = env_file.read_text(encoding="utf-8")
        assert "WHISPER_MODEL=large" in text and "WHISPER_VAD_THRESHOLD=0.3" in text

    def test_requires_auth(self, test_client):
        assert test_client.patch("/api/settings/voice", json={"whisper_model": "small"}).status_code == 401
# ---------------------------------------------------------------------------
# POST /api/model/swap
# ---------------------------------------------------------------------------

def _parse_sse_events(body: str) -> list[dict]:
    return [json.loads(line[len("data: "):]) for line in body.splitlines() if line.startswith("data: ")]


class TestPostModelSwap:
    def test_invalid_tier_returns_422(self, test_client):
        resp = test_client.post("/api/model/swap", json={"tier": "ULTRA_MEGA", "restart": False}, headers=test_client.auth_headers)
        assert resp.status_code == 422 and "ULTRA_MEGA" in resp.json()["detail"]

    def test_missing_dream_cli_returns_501(self, test_client, monkeypatch):
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: None)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        assert resp.status_code == 501 and "dream-cli" in resp.json()["detail"].lower()

    def test_tier_normalised_to_uppercase(self, test_client, fake_cli, monkeypatch):
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: fake_cli)
        assert test_client.post("/api/model/swap", json={"tier": "t2", "restart": False}, headers=test_client.auth_headers).status_code == 200

    def test_valid_tiers_accepted(self, test_client, fake_cli, monkeypatch):
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: fake_cli)
        for tier in ("T0","T1","T2","T3","T4","NV_ULTRA","SH_COMPACT","SH_LARGE"):
            resp = test_client.post("/api/model/swap", json={"tier": tier, "restart": False}, headers=test_client.auth_headers)
            assert resp.status_code == 200, f"tier {tier!r} unexpectedly rejected"

    def test_sse_content_type(self, test_client, fake_cli, monkeypatch):
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: fake_cli)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        assert resp.headers["content-type"].startswith("text/event-stream")

    def test_sse_done_event_on_success(self, test_client, tmp_path, monkeypatch):
        cli = tmp_path / "dream-cli"
        cli.write_text(chr(10).join(["#!/bin/bash", "echo Model set to qwen3-8b", "exit 0", ""]))
        cli.chmod(0o755)
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: cli)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        events = _parse_sse_events(resp.text)
        assert "done" in [e["type"] for e in events]
        done = next(e for e in events if e["type"] == "done")
        assert done["success"] is True and done["restarted"] is False

    def test_sse_error_event_on_nonzero_exit(self, test_client, tmp_path, monkeypatch):
        cli = tmp_path / "dream-cli"
        cli.write_text(chr(10).join(["#!/bin/bash", "echo swap failed", "exit 1", ""]))
        cli.chmod(0o755)
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: cli)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        events = _parse_sse_events(resp.text)
        types = [e["type"] for e in events]
        assert "error" in types and "done" not in types
        assert next(e for e in events if e["type"] == "error")["step"] == "swap"

    def test_log_events_have_message_field(self, test_client, tmp_path, monkeypatch):
        cli = tmp_path / "dream-cli"
        cli.write_text(chr(10).join(["#!/bin/bash", "echo step one", "echo step two", "exit 0", ""]))
        cli.chmod(0o755)
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: cli)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        log_events = [e for e in _parse_sse_events(resp.text) if e.get("type") == "log"]
        assert all("message" in e for e in log_events)

    def test_ansi_codes_stripped(self, test_client, tmp_path, monkeypatch):
        cli = tmp_path / "dream-cli"
        esc = chr(27)
        sq = chr(39)
        # printf with ANSI colour sequence: ESC[32mGreenESC[0m
        cli.write_text(chr(10).join([
            "#!/bin/bash",
            "printf " + sq + esc + "[32mGreen" + esc + "[0m" + chr(10) + sq,
            "exit 0",
            "",
        ]))
        cli.chmod(0o755)
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: cli)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        for event in _parse_sse_events(resp.text):
            if event.get("type") == "log":
                assert chr(27) + "[" not in event["message"], "ANSI code leaked"

    def test_cache_control_header(self, test_client, fake_cli, monkeypatch):
        import routers.model_swap as ms
        monkeypatch.setattr(ms, "_find_dream_cli", lambda: fake_cli)
        resp = test_client.post("/api/model/swap", json={"tier": "T2", "restart": False}, headers=test_client.auth_headers)
        assert resp.headers.get("cache-control") == "no-cache"

    def test_requires_auth(self, test_client):
        assert test_client.post("/api/model/swap", json={"tier": "T2"}).status_code == 401
