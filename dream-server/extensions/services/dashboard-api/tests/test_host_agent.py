"""Tests for dream-host-agent.py — _parse_mem_value and _iso_now."""

import importlib.util
import sys
from pathlib import Path, PurePosixPath

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
