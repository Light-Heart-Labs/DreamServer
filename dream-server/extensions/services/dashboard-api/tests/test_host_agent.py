"""Tests for dream-host-agent.py — _parse_mem_value and _iso_now."""

import importlib.util
import io
import json
import sys
from pathlib import Path, PurePosixPath

import pytest

# Import the host agent module from bin/ using importlib.
# The module has an ``if __name__ == "__main__":`` guard so no server starts.
_agent_path = Path(__file__).resolve().parents[4] / "bin" / "dream-host-agent.py"
_spec = importlib.util.spec_from_file_location("dream_host_agent", _agent_path)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["dream_host_agent"] = _mod
_spec.loader.exec_module(_mod)

_parse_mem_value = _mod._parse_mem_value
_iso_now = _mod._iso_now
_to_bash_path = _mod._to_bash_path
resolve_compose_flags = _mod.resolve_compose_flags
validate_core_recreate_ids = _mod.validate_core_recreate_ids
invalidate_compose_cache = _mod.invalidate_compose_cache
_post_install_core_recreate = _mod._post_install_core_recreate


# --- _parse_mem_value ---


class TestParseMemValue:

    def test_mib(self):
        assert _parse_mem_value("256MiB") == 256.0

    def test_gib(self):
        assert _parse_mem_value("4GiB") == 4096.0

    def test_tib(self):
        assert _parse_mem_value("1TiB") == 1024 * 1024

    def test_kib(self):
        assert _parse_mem_value("512KiB") == 0.5

    def test_bytes(self):
        result = _parse_mem_value("1024B")
        assert abs(result - 1024 / (1024 * 1024)) < 1e-9

    def test_fractional_gib(self):
        assert _parse_mem_value("1.5GiB") == 1536.0

    def test_zero_bytes(self):
        assert _parse_mem_value("0B") == 0.0

    def test_dash_dash(self):
        assert _parse_mem_value("--") == 0.0

    def test_empty_string(self):
        assert _parse_mem_value("") == 0.0

    def test_invalid_number(self):
        assert _parse_mem_value("xyzMiB") == 0.0

    def test_whitespace_padding(self):
        assert _parse_mem_value("  256MiB  ") == 256.0


# --- _iso_now ---


class TestIsoNow:

    def test_returns_utc_iso_string(self):
        result = _iso_now()
        assert isinstance(result, str)
        # UTC ISO strings end with +00:00
        assert "+00:00" in result

    def test_contains_t_separator(self):
        result = _iso_now()
        assert "T" in result


class TestToBashPath:

    def test_leaves_posix_paths_unchanged(self, monkeypatch):
        monkeypatch.setattr(_mod.platform, "system", lambda: "Linux")
        assert _to_bash_path(PurePosixPath("/opt/dream-server")) == "/opt/dream-server"

    def test_converts_windows_drive_path(self, monkeypatch):
        monkeypatch.setattr(_mod.platform, "system", lambda: "Windows")
        assert _to_bash_path(Path(r"C:\Users\Gabriel\dream-server")) == "/c/Users/Gabriel/dream-server"


class TestValidateCoreRecreateIds:

    def test_accepts_allowed_core_service(self, monkeypatch):
        monkeypatch.setattr(_mod, "CORE_SERVICE_IDS", {"llama-server", "dashboard-api"})
        ok, error = validate_core_recreate_ids(["llama-server"])
        assert ok is True
        assert error == ""

    def test_rejects_non_core_service(self, monkeypatch):
        monkeypatch.setattr(_mod, "CORE_SERVICE_IDS", {"dashboard-api"})
        ok, error = validate_core_recreate_ids(["llama-server"])
        assert ok is False
        assert "not a core" in error.lower()

    def test_rejects_disallowed_core_service(self, monkeypatch):
        monkeypatch.setattr(_mod, "CORE_SERVICE_IDS", {"dashboard-api"})
        ok, error = validate_core_recreate_ids(["dashboard-api"])
        assert ok is False
        assert "not eligible" in error.lower()


class TestResolveComposeFlags:

    def test_prefers_saved_compose_flags_file(self, tmp_path, monkeypatch):
        install_dir = tmp_path / "dream-server"
        install_dir.mkdir()
        (install_dir / ".compose-flags").write_text("--env-file .env -f docker-compose.base.yml", encoding="utf-8")

        monkeypatch.setattr(_mod, "INSTALL_DIR", install_dir)

        assert resolve_compose_flags() == ["--env-file", ".env", "-f", "docker-compose.base.yml"]


class TestComposeCacheInvalidationWire:
    """End-to-end HTTP test: dashboard-api client talks to the real host-agent handler."""

    def test_client_posts_to_host_agent_and_unlinks_cache(self, tmp_path, monkeypatch):
        import threading
        from http.server import HTTPServer

        from routers import extensions as ext_router

        install_dir = tmp_path / "dream-server"
        install_dir.mkdir()
        cache_file = install_dir / ".compose-flags"
        cache_file.write_text("stale-flags", encoding="utf-8")

        monkeypatch.setattr(_mod, "INSTALL_DIR", install_dir)
        monkeypatch.setattr(_mod, "AGENT_API_KEY", "wire-test-secret")

        server = HTTPServer(("127.0.0.1", 0), _mod.AgentHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            monkeypatch.setattr(ext_router, "AGENT_URL", f"http://127.0.0.1:{port}")
            monkeypatch.setattr(ext_router, "DREAM_AGENT_KEY", "wire-test-secret")

            # Correct key → cache file is unlinked, helper returns without raising.
            ext_router._call_agent_invalidate_compose_cache()
            assert not cache_file.exists()

            # Wrong key → handler rejects with 403, helper logs and returns; cache
            # stays put. Proves the Authorization: Bearer <key> header is checked.
            cache_file.write_text("stale-again", encoding="utf-8")
            monkeypatch.setattr(ext_router, "DREAM_AGENT_KEY", "wrong-secret")
            ext_router._call_agent_invalidate_compose_cache()
            assert cache_file.exists()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class TestComposeToggleWire:
    """End-to-end HTTP test for built-in compose toggles via the host agent."""

    def test_client_posts_to_host_agent_and_renames_builtin_compose(
        self, tmp_path, monkeypatch,
    ):
        import threading
        from http.server import HTTPServer

        from routers import extensions as ext_router

        builtin_root = tmp_path / "builtin"
        user_root = tmp_path / "user"
        builtin_root.mkdir()
        user_root.mkdir()
        ext_dir = builtin_root / "fakesvc"
        ext_dir.mkdir()
        (ext_dir / "compose.yaml.disabled").write_text(
            "services:\n  svc:\n    image: test:latest\n",
            encoding="utf-8",
        )

        monkeypatch.setattr(_mod, "EXTENSIONS_DIR", builtin_root)
        monkeypatch.setattr(_mod, "USER_EXTENSIONS_DIR", user_root)
        monkeypatch.setattr(_mod, "AGENT_API_KEY", "wire-test-secret")

        server = HTTPServer(("127.0.0.1", 0), _mod.AgentHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            monkeypatch.setattr(ext_router, "AGENT_URL", f"http://127.0.0.1:{port}")
            monkeypatch.setattr(ext_router, "DREAM_AGENT_KEY", "wire-test-secret")

            assert ext_router._call_agent_compose_rename("activate", "fakesvc") is True
            assert (ext_dir / "compose.yaml").exists()
            assert not (ext_dir / "compose.yaml.disabled").exists()

            assert ext_router._call_agent_compose_rename("deactivate", "fakesvc") is True
            assert (ext_dir / "compose.yaml.disabled").exists()
            assert not (ext_dir / "compose.yaml").exists()

            monkeypatch.setattr(ext_router, "DREAM_AGENT_KEY", "wrong-secret")
            assert ext_router._call_agent_compose_rename("activate", "fakesvc") is False
            assert (ext_dir / "compose.yaml.disabled").exists()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class TestInvalidateComposeCache:

    def test_unlinks_existing_cache_file(self, tmp_path, monkeypatch):
        install_dir = tmp_path / "dream-server"
        install_dir.mkdir()
        cache_file = install_dir / ".compose-flags"
        cache_file.write_text("--env-file .env", encoding="utf-8")
        monkeypatch.setattr(_mod, "INSTALL_DIR", install_dir)

        invalidate_compose_cache()

        assert not cache_file.exists()

    def test_missing_cache_file_is_noop(self, tmp_path, monkeypatch):
        install_dir = tmp_path / "dream-server"
        install_dir.mkdir()
        monkeypatch.setattr(_mod, "INSTALL_DIR", install_dir)

        invalidate_compose_cache()  # must not raise


# --- Install setup-hook env allowlist (regression) ---
#
# Locks in the fix that strips host-agent secrets from the env passed to
# extension setup hooks during _handle_install. A source-level check is used
# because the subprocess.run call lives inside a nested closure started on a
# daemon thread, which makes dynamic mocking fragile.


class TestInstallHookEnvAllowlist:

    def _install_source(self):
        import inspect
        return inspect.getsource(_mod.AgentHandler._handle_install)

    def test_setup_hook_subprocess_run_passes_env_kwarg(self):
        src = self._install_source()
        assert "env=hook_env" in src, (
            "setup_hook subprocess.run must pass env=hook_env "
            "(regression: do not fall back to inheriting os.environ)"
        )

    def test_setup_hook_env_excludes_host_agent_secrets(self):
        src = self._install_source()
        for secret in ("AGENT_API_KEY", "DREAM_AGENT_KEY", "DASHBOARD_API_KEY"):
            assert secret not in src, (
                f"_handle_install must not reference {secret}; "
                "extension setup hooks must not receive host-agent secrets"
            )

    def test_setup_hook_env_contains_allowlist_keys(self):
        src = self._install_source()
        for key in (
            "PATH", "HOME", "SERVICE_ID", "SERVICE_PORT",
            "SERVICE_DATA_DIR", "DREAM_VERSION", "GPU_BACKEND", "HOOK_NAME",
        ):
            assert f'"{key}"' in src, (
                f"setup_hook env allowlist missing required key {key}"
            )

    def test_setup_hook_uses_resolve_hook_with_post_install(self):
        src = self._install_source()
        assert '_resolve_hook(ext_dir, "post_install")' in src, (
            "setup_hook must use _resolve_hook(..., 'post_install'); "
            "the legacy _resolve_setup_hook has been removed"
        )


# --- Install "up -d" must not use --no-deps (regression) ---
#
# _handle_install previously passed --no-deps to `docker compose up -d`, which
# prevented an extension's private sidecar services (declared in its own
# compose fragment) from starting — including cross-extension depends_on
# relationships like perplexica -> searxng. The fix removes --no-deps from
# the install path only; docker_compose_recreate (used for core-service
# force-recreate after a model swap) intentionally keeps --no-deps.


class TestInstallStartCommandNoDeps:

    def _install_source(self):
        import inspect
        return inspect.getsource(_mod.AgentHandler._handle_install)

    def _recreate_source(self):
        import inspect
        return inspect.getsource(_mod.docker_compose_recreate)

    def test_install_up_command_does_not_pass_no_deps(self):
        src = self._install_source()
        assert '"--no-deps"' not in src and "'--no-deps'" not in src, (
            "_handle_install must not pass --no-deps to `docker compose up -d`; "
            "extensions with private sidecars or cross-extension depends_on "
            "need compose to bring dependencies up."
        )

    def test_docker_compose_recreate_still_uses_no_deps(self):
        src = self._recreate_source()
        assert '"--no-deps"' in src or "'--no-deps'" in src, (
            "docker_compose_recreate must keep --no-deps; "
            "core-service recreation (e.g. after a model swap) is intentionally "
            "scoped to the named services only."
        )


# --- _post_install_core_recreate ---
#
# openclaw's compose.yaml adds OPENAI_API_BASE_URLS to open-webui as an overlay;
# `docker compose up -d openclaw` (used by _handle_install) won't pick up
# overlay changes targeting already-running core services without
# `--force-recreate`. Hence the post-install recreate of open-webui whenever
# openclaw is installed.


class TestPostInstallCoreRecreate:

    def test_openclaw_triggers_open_webui_recreate(self, monkeypatch):
        calls = []

        def _fake_recreate(ids):
            calls.append(list(ids))
            return True, ""

        monkeypatch.setattr(_mod, "docker_compose_recreate", _fake_recreate)
        _post_install_core_recreate("openclaw")
        assert calls == [["open-webui"]]

    def test_non_openclaw_service_is_noop(self, monkeypatch):
        calls = []

        def _fake_recreate(ids):
            calls.append(list(ids))
            return True, ""

        monkeypatch.setattr(_mod, "docker_compose_recreate", _fake_recreate)
        for svc in ("litellm", "n8n", "perplexica", "whisper", "comfyui"):
            _post_install_core_recreate(svc)
        assert calls == []

    def test_recreate_failure_is_swallowed(self, monkeypatch):
        """Install must not fail if the post-install recreate errors — openclaw
        is already running; the overlay just won't take effect until a manual
        core restart."""

        def _fake_recreate(_ids):
            return False, "docker compose exploded"

        monkeypatch.setattr(_mod, "docker_compose_recreate", _fake_recreate)
        # Must not raise
        _post_install_core_recreate("openclaw")


class TestRunInstallCallsPostInstallRecreate:
    """Source-level check that the install closure calls
    _post_install_core_recreate after the "started" progress write.

    The dynamic flow runs in a daemon thread + nested closure, which makes
    runtime mocking fragile (see TestInstallHookEnvAllowlist for the same
    reasoning). Source-level assertion is sufficient to lock the wiring."""

    def _install_source(self):
        import inspect
        return inspect.getsource(_mod.AgentHandler._handle_install)

    def test_install_calls_post_install_core_recreate(self):
        src = self._install_source()
        assert "_post_install_core_recreate(service_id)" in src, (
            "_run_install must invoke _post_install_core_recreate(service_id) "
            "after emitting the 'started' progress record"
        )

    def test_recreate_is_after_started_progress_write(self):
        src = self._install_source()
        started_idx = src.find('"started"')
        recreate_idx = src.find("_post_install_core_recreate(")
        assert started_idx != -1, "expected 'started' progress write in _handle_install"
        assert recreate_idx != -1, "expected _post_install_core_recreate call in _handle_install"
        assert started_idx < recreate_idx, (
            "_post_install_core_recreate must run AFTER the 'started' progress "
            "write so the client sees success even if the recreate fails"
        )


# --- _handle_env_update ---


class _FakeHandler:
    """Minimal stand-in for BaseHTTPRequestHandler used by _handle_env_update."""

    def __init__(self, body: bytes, headers=None):
        merged = {
            "Authorization": "Bearer test-key",
            "Content-Length": str(len(body)),
        }
        if headers:
            merged.update(headers)
        self.headers = merged
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.client_address = ("127.0.0.1", 12345)
        self.response_code = None
        self.response_headers = []

    def send_response(self, code):
        self.response_code = code

    def send_header(self, name, value):
        self.response_headers.append((name, value))

    def end_headers(self):
        pass

    def parse_response(self):
        # json_response writes the JSON body via wfile.write()
        return json.loads(self.wfile.getvalue().decode("utf-8"))


@pytest.fixture
def env_update_env(tmp_path, monkeypatch):
    """Wire up INSTALL_DIR/DATA_DIR/AGENT_API_KEY for _handle_env_update tests."""
    install_dir = tmp_path / "install"
    install_dir.mkdir()
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    schema = {
        "properties": {
            "DREAM_AGENT_KEY": {"type": "string"},
            "GGUF_FILE": {"type": "string"},
        }
    }
    (install_dir / ".env.schema.json").write_text(json.dumps(schema), encoding="utf-8")
    (install_dir / ".env").write_text("DREAM_AGENT_KEY=existing\n", encoding="utf-8")

    monkeypatch.setattr(_mod, "INSTALL_DIR", install_dir)
    monkeypatch.setattr(_mod, "DATA_DIR", data_dir)
    monkeypatch.setattr(_mod, "AGENT_API_KEY", "test-key")
    return install_dir, data_dir


def _make_body(raw_text: str, backup: bool = True) -> bytes:
    return json.dumps({"raw_text": raw_text, "backup": backup}).encode("utf-8")


class TestHandleEnvUpdate:

    def test_happy_path_writes_file_and_returns_backup(self, env_update_env):
        install_dir, data_dir = env_update_env
        body = _make_body("DREAM_AGENT_KEY=newvalue\nGGUF_FILE=/models/foo.gguf\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 200
        resp = handler.parse_response()
        assert resp["status"] == "ok"
        assert resp["backup_path"].startswith("data/config-backups/.env.backup.")
        env_text = (install_dir / ".env").read_text(encoding="utf-8")
        assert "DREAM_AGENT_KEY=newvalue" in env_text
        assert "GGUF_FILE=/models/foo.gguf" in env_text
        # backup file actually exists where the response says it does
        backup_files = list((data_dir / "config-backups").glob(".env.backup.*"))
        assert len(backup_files) == 1

    def test_413_oversize_body(self, env_update_env):
        # Construct headers claiming body is too large; rfile content is irrelevant.
        handler = _FakeHandler(b"x", headers={"Content-Length": str(_mod.MAX_BODY + 999999) if hasattr(_mod, "MAX_BODY") else "100000"})
        # MAX_ENV_BODY is hard-coded to 65536 inside the handler.
        handler.headers["Content-Length"] = "70000"

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 413
        assert "too large" in handler.parse_response()["error"].lower()

    def test_accepts_unknown_key_with_warning(self, env_update_env):
        """Non-schema keys are accepted (warn, not reject) so extension-added
        keys (e.g. JWT_SECRET from LibreChat) don't break Settings save."""
        install_dir, data_dir = env_update_env
        (install_dir / ".env").write_text("DREAM_AGENT_KEY=old\n", encoding="utf-8")
        body = _make_body("DREAM_AGENT_KEY=old\nNOT_IN_SCHEMA=foo\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 200
        env_text = (install_dir / ".env").read_text(encoding="utf-8")
        assert "NOT_IN_SCHEMA=foo" in env_text

    def test_400_malformed_line(self, env_update_env):
        body = _make_body("THIS_LINE_HAS_NO_EQUALS\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 400
        assert "Malformed line" in handler.parse_response()["error"]

    def test_400_control_char_in_value(self, env_update_env):
        body = _make_body("DREAM_AGENT_KEY=foo\x00bar\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 400
        assert "control characters" in handler.parse_response()["error"]

    def test_400_control_char_escape_sequence(self, env_update_env):
        # ESC (0x1b) — common in injected ANSI sequences
        body = _make_body("DREAM_AGENT_KEY=foo\x1b[31mbar\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 400

    def test_tab_in_value_is_allowed(self, env_update_env):
        # Tab is the only sub-32 char that should pass through.
        body = _make_body("DREAM_AGENT_KEY=foo\tbar\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 200

    def test_409_lock_contention(self, env_update_env):
        body = _make_body("DREAM_AGENT_KEY=newvalue\n")
        handler = _FakeHandler(body)

        assert _mod._model_activate_lock.acquire(blocking=False)
        try:
            _mod.AgentHandler._handle_env_update(handler)
        finally:
            _mod._model_activate_lock.release()

        assert handler.response_code == 409
        assert "in progress" in handler.parse_response()["error"]

    def test_500_missing_schema(self, env_update_env):
        install_dir, _ = env_update_env
        (install_dir / ".env.schema.json").unlink()
        body = _make_body("DREAM_AGENT_KEY=newvalue\n")
        handler = _FakeHandler(body)

        _mod.AgentHandler._handle_env_update(handler)

        assert handler.response_code == 500
        assert ".env.schema.json not found" in handler.parse_response()["error"]


class TestHandleModelDownloadCancel:

    def test_returns_no_download_when_idle(self, monkeypatch):
        handler = _FakeHandler(b"")
        monkeypatch.setattr(_mod, "AGENT_API_KEY", "test-key")
        monkeypatch.setattr(_mod, "_model_download_thread", None)
        _mod._model_download_cancel.clear()

        _mod.AgentHandler._handle_model_download_cancel(handler)

        assert handler.response_code == 200
        assert handler.parse_response()["status"] == "no_download"
        assert _mod._model_download_cancel.is_set() is False

    def test_sets_cancel_flag_and_kills_active_proc(self, monkeypatch):
        class _AliveThread:
            def is_alive(self):
                return True

        class _FakeProc:
            def __init__(self):
                self.killed = False

            def kill(self):
                self.killed = True

        handler = _FakeHandler(b"")
        proc = _FakeProc()
        monkeypatch.setattr(_mod, "AGENT_API_KEY", "test-key")
        monkeypatch.setattr(_mod, "_model_download_thread", _AliveThread())
        monkeypatch.setattr(_mod, "_model_download_proc", proc)
        _mod._model_download_cancel.clear()

        _mod.AgentHandler._handle_model_download_cancel(handler)

        assert handler.response_code == 200
        assert handler.parse_response()["status"] == "cancelling"
        assert _mod._model_download_cancel.is_set() is True
        assert proc.killed is True
