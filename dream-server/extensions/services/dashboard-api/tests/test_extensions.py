"""Tests for extensions portal endpoints."""

import contextlib
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import yaml
from models import ServiceStatus


# --- Helpers ---


def _make_catalog_ext(ext_id, name="Test", category="optional",
                      gpu_backends=None, env_vars=None, features=None):
    return {
        "id": ext_id,
        "name": name,
        "description": f"Description for {name}",
        "category": category,
        "gpu_backends": gpu_backends or ["nvidia", "amd", "apple"],
        "compose_file": "compose.yaml",
        "depends_on": [],
        "port": 8080,
        "external_port_default": 8080,
        "health_endpoint": "/health",
        "env_vars": env_vars or [],
        "tags": [],
        "features": features or [],
    }


def _make_service_status(sid, status="healthy"):
    return ServiceStatus(
        id=sid, name=sid, port=8080, external_port=8080, status=status,
    )


def _patch_extensions_config(monkeypatch, catalog, services=None,
                             gpu_backend="nvidia", tmp_path=None):
    """Apply standard patches for extensions router tests."""
    monkeypatch.setattr("routers.extensions.EXTENSION_CATALOG", catalog)
    monkeypatch.setattr("routers.extensions.SERVICES", services or {})
    monkeypatch.setattr("routers.extensions.GPU_BACKEND", gpu_backend)
    lib_dir = (tmp_path / "lib") if tmp_path else Path("/tmp/nonexistent-lib")
    user_dir = (tmp_path / "user") if tmp_path else Path("/tmp/nonexistent-user")
    monkeypatch.setattr("routers.extensions.EXTENSIONS_LIBRARY_DIR", lib_dir)
    monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)
    monkeypatch.setattr("routers.extensions.DATA_DIR",
                        str(tmp_path or "/tmp/nonexistent"))


# --- Catalog endpoint ---


class TestExtensionsCatalog:

    def test_catalog_returns_enriched_extensions(self, test_client, monkeypatch, tmp_path):
        """Catalog endpoint returns extensions with status enrichment."""
        catalog = [_make_catalog_ext("test-svc", "Test Service")]
        services = {"test-svc": {"host": "localhost", "port": 8080, "name": "Test"}}
        _patch_extensions_config(monkeypatch, catalog, services, tmp_path=tmp_path)

        mock_svc = _make_service_status("test-svc", "healthy")
        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[mock_svc]):
            resp = test_client.get(
                "/api/extensions/catalog",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["extensions"]) == 1
        assert data["extensions"][0]["status"] == "enabled"
        assert data["extensions"][0]["installable"] is False
        assert "summary" in data
        assert data["gpu_backend"] == "nvidia"

    def test_catalog_category_filter(self, test_client, monkeypatch, tmp_path):
        """Category filter returns only matching extensions."""
        catalog = [
            _make_catalog_ext("svc-a", "A", category="ai"),
            _make_catalog_ext("svc-b", "B", category="tools"),
        ]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)

        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[]):
            resp = test_client.get(
                "/api/extensions/catalog?category=ai",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["extensions"]) == 1
        assert data["extensions"][0]["id"] == "svc-a"

    def test_catalog_gpu_compatible_filter(self, test_client, monkeypatch, tmp_path):
        """gpu_compatible filter excludes incompatible extensions."""
        catalog = [
            _make_catalog_ext("compat", "Compatible", gpu_backends=["nvidia"]),
            _make_catalog_ext("incompat", "Incompatible", gpu_backends=["amd"]),
        ]
        _patch_extensions_config(monkeypatch, catalog, gpu_backend="nvidia",
                                 tmp_path=tmp_path)

        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[]):
            resp = test_client.get(
                "/api/extensions/catalog?gpu_compatible=true",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        ids = [e["id"] for e in data["extensions"]]
        assert "compat" in ids
        assert "incompat" not in ids

    def test_catalog_summary_counts(self, test_client, monkeypatch, tmp_path):
        """Summary counts correctly reflect extension statuses."""
        catalog = [
            _make_catalog_ext("enabled-svc", "Enabled"),
            _make_catalog_ext("disabled-svc", "Disabled"),
            _make_catalog_ext("not-installed", "Not Installed"),
            _make_catalog_ext("incompat", "Incompatible", gpu_backends=["amd"]),
        ]
        services = {
            "enabled-svc": {"host": "localhost", "port": 8080, "name": "Enabled"},
            "disabled-svc": {"host": "localhost", "port": 8081, "name": "Disabled"},
        }
        _patch_extensions_config(monkeypatch, catalog, services,
                                 gpu_backend="nvidia", tmp_path=tmp_path)

        mock_svcs = [
            _make_service_status("enabled-svc", "healthy"),
            _make_service_status("disabled-svc", "down"),
        ]
        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=mock_svcs):
            resp = test_client.get(
                "/api/extensions/catalog",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        summary = resp.json()["summary"]
        assert summary["total"] == 4
        assert summary["enabled"] == 1
        assert summary["disabled"] == 1
        assert summary["not_installed"] == 1
        assert summary["incompatible"] == 1
        assert summary["installed"] == 2

    def test_catalog_empty_when_no_catalog(self, test_client, monkeypatch, tmp_path):
        """Missing catalog file results in empty extensions list."""
        _patch_extensions_config(monkeypatch, [], tmp_path=tmp_path)

        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[]):
            resp = test_client.get(
                "/api/extensions/catalog",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["extensions"] == []
        assert data["summary"]["total"] == 0

    def test_catalog_requires_auth(self, test_client):
        """GET /api/extensions/catalog without auth → 401."""
        resp = test_client.get("/api/extensions/catalog")
        assert resp.status_code == 401


# --- Detail endpoint ---


class TestExtensionDetail:

    def test_detail_returns_extension(self, test_client, monkeypatch, tmp_path):
        """Detail endpoint returns correct extension with setup instructions."""
        catalog = [_make_catalog_ext("test-svc", "Test Service")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)

        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[]):
            resp = test_client.get(
                "/api/extensions/test-svc",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "test-svc"
        assert data["name"] == "Test Service"
        assert data["status"] == "not_installed"
        assert "manifest" in data
        assert "setup_instructions" in data
        assert data["setup_instructions"]["cli_enable"] == "dream enable test-svc"
        assert data["setup_instructions"]["cli_disable"] == "dream disable test-svc"

    def test_detail_404_for_unknown(self, test_client, monkeypatch, tmp_path):
        """404 for service_id not in catalog."""
        _patch_extensions_config(monkeypatch, [], tmp_path=tmp_path)

        resp = test_client.get(
            "/api/extensions/nonexistent",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 404

    def test_detail_rejects_path_traversal(self, test_client, monkeypatch, tmp_path):
        """Regex validation rejects path traversal and invalid service IDs."""
        _patch_extensions_config(monkeypatch, [], tmp_path=tmp_path)

        for bad_id in ["..etc", ".hidden", "UPPERCASE", "-starts-dash"]:
            resp = test_client.get(
                f"/api/extensions/{bad_id}",
                headers=test_client.auth_headers,
            )
            assert resp.status_code == 404, f"Expected 404 for: {bad_id}"

    def test_detail_path_traversal_with_slashes(self, test_client):
        """Path traversal with slashes never reaches the handler."""
        # Starlette normalizes ../etc/passwd out of the route
        resp = test_client.get(
            "/api/extensions/../etc/passwd",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 404

        resp = test_client.get(
            "/api/extensions/../../",
            headers=test_client.auth_headers,
        )
        assert resp.status_code in (404, 307)

    def test_detail_requires_auth(self, test_client):
        """GET /api/extensions/{id} without auth → 401."""
        resp = test_client.get("/api/extensions/test-svc")
        assert resp.status_code == 401


# --- User-installed extension status ---


class TestUserExtensionStatus:

    def test_user_ext_compose_yaml_healthy(self, test_client, monkeypatch, tmp_path):
        """User extension with compose.yaml + healthy service → enabled."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml").write_text("version: '3'")

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        mock_svc = _make_service_status("my-ext", "healthy")
        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[mock_svc]):
            resp = test_client.get(
                "/api/extensions/catalog",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["id"] == "my-ext"
        assert ext["status"] == "enabled"

    def test_user_ext_compose_yaml_no_service(self, test_client, monkeypatch, tmp_path):
        """User extension with compose.yaml but no running container → stopped."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml").write_text("version: '3'")

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        # No service in health results — svc is None → stopped
        with patch("user_extensions.get_user_services_cached",
                   return_value={}):
            with patch("helpers.get_all_services", new_callable=AsyncMock,
                       return_value=[]):
                resp = test_client.get(
                    "/api/extensions/catalog",
                    headers=test_client.auth_headers,
                )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["id"] == "my-ext"
        assert ext["status"] == "stopped"

    def test_user_ext_compose_yaml_disabled(self, test_client, monkeypatch, tmp_path):
        """User extension with compose.yaml.disabled → disabled."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml.disabled").write_text("version: '3'")

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        with patch("helpers.get_all_services", new_callable=AsyncMock,
                   return_value=[]):
            resp = test_client.get(
                "/api/extensions/catalog",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["id"] == "my-ext"
        assert ext["status"] == "disabled"


# --- Mutation test helpers ---


_SAFE_COMPOSE = "services:\n  svc:\n    image: test:latest\n"


def _setup_library_ext(tmp_path, service_id, compose_content=None):
    """Create a library extension directory with compose.yaml and manifest."""
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir(exist_ok=True)
    ext_dir = lib_dir / service_id
    ext_dir.mkdir(exist_ok=True)
    (ext_dir / "compose.yaml").write_text(compose_content or _SAFE_COMPOSE)
    (ext_dir / "manifest.yaml").write_text(yaml.dump({
        "schema_version": "dream.services.v1",
        "service": {"id": service_id, "name": service_id},
    }))
    return lib_dir


def _setup_user_ext(tmp_path, service_id, enabled=True, manifest=None):
    """Create a user-installed extension directory."""
    user_dir = tmp_path / "user"
    user_dir.mkdir(exist_ok=True)
    ext_dir = user_dir / service_id
    ext_dir.mkdir(exist_ok=True)
    if enabled:
        (ext_dir / "compose.yaml").write_text(_SAFE_COMPOSE)
    else:
        (ext_dir / "compose.yaml.disabled").write_text(_SAFE_COMPOSE)
    if manifest:
        (ext_dir / "manifest.yaml").write_text(yaml.dump(manifest))
    return user_dir


def _patch_mutation_config(monkeypatch, tmp_path, lib_dir=None, user_dir=None):
    """Patch config values for mutation endpoint tests."""
    lib_dir = lib_dir or (tmp_path / "lib")
    user_dir = user_dir or (tmp_path / "user")
    lib_dir.mkdir(exist_ok=True)
    user_dir.mkdir(exist_ok=True)
    monkeypatch.setattr("routers.extensions.EXTENSIONS_LIBRARY_DIR", lib_dir)
    monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)
    monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))
    monkeypatch.setattr("routers.extensions.EXTENSIONS_DIR",
                        tmp_path / "builtin")
    monkeypatch.setattr("routers.extensions.CORE_SERVICE_IDS",
                        frozenset({"dashboard-api", "open-webui"}))


# --- Install endpoint ---


class TestInstallExtension:

    def test_install_copies_and_enables(self, test_client, monkeypatch, tmp_path):
        """Install copies from library and keeps compose.yaml enabled."""
        lib_dir = _setup_library_ext(tmp_path, "my-ext")
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/install",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "my-ext"
        assert data["action"] == "installed"
        assert "restart_required" in data

        user_dir = tmp_path / "user"
        assert (user_dir / "my-ext").is_dir()
        assert (user_dir / "my-ext" / "compose.yaml").exists()

    def test_install_cleans_broken_directory(self, test_client, monkeypatch, tmp_path):
        """Install succeeds when dest dir exists but has no compose files (broken state)."""
        lib_dir = _setup_library_ext(tmp_path, "my-ext")
        # Create a broken user extension directory (no compose.yaml or compose.yaml.disabled)
        user_dir = tmp_path / "user"
        user_dir.mkdir(exist_ok=True)
        broken_dir = user_dir / "my-ext"
        broken_dir.mkdir(exist_ok=True)
        (broken_dir / "manifest.yaml").write_text("leftover: true\n")
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir,
                               user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/install",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "installed"
        assert (user_dir / "my-ext" / "compose.yaml").exists()

    def test_install_already_installed_409(self, test_client, monkeypatch, tmp_path):
        """409 when extension is already installed."""
        lib_dir = _setup_library_ext(tmp_path, "my-ext")
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir,
                               user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 409

    def test_install_unknown_extension_404(self, test_client, monkeypatch, tmp_path):
        """404 when extension is not in the library."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.post(
            "/api/extensions/nonexistent/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 404

    def test_install_core_service_403(self, test_client, monkeypatch, tmp_path):
        """403 when trying to install a core service."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.post(
            "/api/extensions/dashboard-api/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 403

    def test_install_rejects_privileged(self, test_client, monkeypatch, tmp_path):
        """400 when compose uses privileged mode."""
        bad_compose = "services:\n  svc:\n    image: test\n    privileged: true\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext",
                                     compose_content=bad_compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "privileged" in resp.json()["detail"]

    def test_install_rejects_docker_socket(self, test_client, monkeypatch, tmp_path):
        """400 when compose mounts Docker socket."""
        bad_compose = (
            "services:\n  svc:\n    image: test\n"
            "    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext",
                                     compose_content=bad_compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "Docker socket mount" in resp.json()["detail"]

    def test_install_allows_library_build_context(self, test_client, monkeypatch, tmp_path):
        """Library extensions with build: context are allowed (trusted)."""
        bad_compose = "services:\n  svc:\n    build: .\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext",
                                     compose_content=bad_compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["action"] == "installed"

    def test_install_requires_auth(self, test_client):
        """POST install without auth → 401."""
        resp = test_client.post("/api/extensions/my-ext/install")
        assert resp.status_code == 401

    # test_install_writes_pending_change removed — v3 uses host agent, no pending changes file


# --- Enable endpoint ---


class TestEnableExtension:

    def test_enable_renames_to_compose_yaml(self, test_client, monkeypatch, tmp_path):
        """Enable renames compose.yaml.disabled → compose.yaml."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "enabled"
        assert data["restart_required"] is True
        assert (user_dir / "my-ext" / "compose.yaml").exists()
        assert not (user_dir / "my-ext" / "compose.yaml.disabled").exists()

    def test_enable_stopped_starts_without_rename(self, test_client, monkeypatch, tmp_path):
        """Enable when compose.yaml exists (stopped) → starts without rename."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "enabled"
        # compose.yaml still exists (no rename happened)
        assert (user_dir / "my-ext" / "compose.yaml").exists()

    def test_enable_allows_core_service_dependency(self, test_client, monkeypatch, tmp_path):
        """Enable succeeds when depends_on includes a core service."""
        manifest = {"service": {"depends_on": ["open-webui"]}}
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False,
                                   manifest=manifest)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "enabled"

    def test_enable_missing_dependency_400(self, test_client, monkeypatch, tmp_path):
        """400 when a dependency is not enabled."""
        manifest = {"service": {"depends_on": ["missing-dep"]}}
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False,
                                   manifest=manifest)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "missing-dep" in detail["missing_dependencies"]
        assert detail["auto_enable_available"] is True

    def test_enable_core_service_403(self, test_client, monkeypatch, tmp_path):
        """403 when trying to enable a core service."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.post(
            "/api/extensions/open-webui/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 403

    def test_enable_requires_auth(self, test_client):
        """POST enable without auth → 401."""
        resp = test_client.post("/api/extensions/my-ext/enable")
        assert resp.status_code == 401

    def test_enable_rejects_build_context(self, test_client, monkeypatch, tmp_path):
        """400 when user extension compose contains a build context."""
        bad_compose = "services:\n  svc:\n    build: .\n"
        user_dir = tmp_path / "user"
        user_dir.mkdir(exist_ok=True)
        ext_dir = user_dir / "bad-ext"
        ext_dir.mkdir(exist_ok=True)
        (ext_dir / "compose.yaml.disabled").write_text(bad_compose)
        (ext_dir / "manifest.yaml").write_text("schema_version: dream.services.v1\nservice:\n  id: bad-ext\n  name: bad-ext\n")
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "local build" in resp.json()["detail"]


# --- Disable endpoint ---


class TestDisableExtension:

    def test_disable_renames_to_disabled(self, test_client, monkeypatch, tmp_path):
        """Disable renames compose.yaml → compose.yaml.disabled."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/disable",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "disabled"
        assert data["restart_required"] is True
        assert (user_dir / "my-ext" / "compose.yaml.disabled").exists()
        assert not (user_dir / "my-ext" / "compose.yaml").exists()

    def test_disable_unlinks_progress_file(self, test_client, monkeypatch, tmp_path):
        """Disable removes the stale progress file so status reflects reality."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)
        progress_file = tmp_path / "extension-progress" / "my-ext.json"
        progress_file.parent.mkdir(parents=True, exist_ok=True)
        progress_file.write_text('{"status": "started", "updated_at": "2026-04-10T00:00:00"}')

        resp = test_client.post(
            "/api/extensions/my-ext/disable",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        assert not progress_file.exists()

    def test_disable_already_disabled_409(self, test_client, monkeypatch, tmp_path):
        """409 when extension is already disabled."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/disable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 409

    def test_disable_core_service_403(self, test_client, monkeypatch, tmp_path):
        """403 when trying to disable a core service."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.post(
            "/api/extensions/dashboard-api/disable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 403

    def test_disable_warns_about_dependents(self, test_client, monkeypatch, tmp_path):
        """Disable warns about extensions that depend on this one."""
        user_dir = tmp_path / "user"
        user_dir.mkdir()
        # Extension to disable
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir()
        (ext_dir / "compose.yaml").write_text(_SAFE_COMPOSE)
        # Dependent extension
        dep_dir = user_dir / "dependent-ext"
        dep_dir.mkdir()
        (dep_dir / "compose.yaml").write_text(_SAFE_COMPOSE)
        (dep_dir / "manifest.yaml").write_text(
            yaml.dump({"service": {"depends_on": ["my-ext"]}}),
        )
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/disable",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert "dependent-ext" in data["dependents_warning"]

    def test_disable_requires_auth(self, test_client):
        """POST disable without auth → 401."""
        resp = test_client.post("/api/extensions/my-ext/disable")
        assert resp.status_code == 401

    def test_disable_skips_data_info(self, test_client, monkeypatch, tmp_path):
        """include_data_info=false → data_info is None (skips expensive dir scan)."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/disable?include_data_info=false",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data_info"] is None


# --- Uninstall endpoint ---


class TestUninstallExtension:

    def test_uninstall_removes_dir(self, test_client, monkeypatch, tmp_path):
        """Uninstall removes the extension directory."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.delete(
            "/api/extensions/my-ext",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "uninstalled"
        assert not (user_dir / "my-ext").exists()

    def test_uninstall_unlinks_progress_file(self, test_client, monkeypatch, tmp_path):
        """Uninstall removes the stale progress file so status reflects reality."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)
        progress_file = tmp_path / "extension-progress" / "my-ext.json"
        progress_file.parent.mkdir(parents=True, exist_ok=True)
        progress_file.write_text('{"status": "started", "updated_at": "2026-04-10T00:00:00"}')

        resp = test_client.delete(
            "/api/extensions/my-ext",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        assert not progress_file.exists()

    def test_uninstall_rejects_enabled_400(self, test_client, monkeypatch, tmp_path):
        """400 when extension is still enabled."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.delete(
            "/api/extensions/my-ext",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "Disable extension before uninstalling" in resp.json()["detail"]

    def test_uninstall_core_service_403(self, test_client, monkeypatch, tmp_path):
        """403 when trying to uninstall a core service."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.delete(
            "/api/extensions/open-webui",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 403

    def test_uninstall_requires_auth(self, test_client):
        """DELETE without auth → 401."""
        resp = test_client.delete("/api/extensions/my-ext")
        assert resp.status_code == 401


# --- Compose-flags cache invalidation ---


class TestComposeCacheInvalidation:
    """Every successful compose mutation must invalidate the host .compose-flags cache."""

    def _spy(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "routers.extensions._call_agent_invalidate_compose_cache",
            lambda: calls.append(1),
        )
        return calls

    def test_install_invalidates_cache(self, test_client, monkeypatch, tmp_path):
        lib_dir = _setup_library_ext(tmp_path, "my-ext")
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)
        calls = self._spy(monkeypatch)

        resp = test_client.post(
            "/api/extensions/my-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        assert len(calls) == 1

    def test_enable_invalidates_cache(self, test_client, monkeypatch, tmp_path):
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)
        calls = self._spy(monkeypatch)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        assert len(calls) == 1

    def test_disable_invalidates_cache(self, test_client, monkeypatch, tmp_path):
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)
        calls = self._spy(monkeypatch)

        resp = test_client.post(
            "/api/extensions/my-ext/disable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        assert len(calls) == 1

    def test_uninstall_invalidates_cache(self, test_client, monkeypatch, tmp_path):
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=False)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)
        calls = self._spy(monkeypatch)

        resp = test_client.delete(
            "/api/extensions/my-ext",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200
        assert len(calls) == 1


# --- Path traversal on mutation endpoints ---


class TestMutationPathTraversal:

    def test_path_traversal_all_mutations(self, test_client, monkeypatch, tmp_path):
        """Path traversal IDs are rejected on all mutation endpoints."""
        _patch_mutation_config(monkeypatch, tmp_path)

        bad_ids = ["..etc", ".hidden", "UPPERCASE", "-starts-dash"]
        endpoints = [
            ("POST", "/api/extensions/{}/install"),
            ("POST", "/api/extensions/{}/enable"),
            ("POST", "/api/extensions/{}/disable"),
            ("DELETE", "/api/extensions/{}"),
            ("DELETE", "/api/extensions/{}/data"),
        ]

        for bad_id in bad_ids:
            for method, pattern in endpoints:
                url = pattern.format(bad_id)
                if method == "POST":
                    resp = test_client.post(
                        url, headers=test_client.auth_headers,
                    )
                elif "/data" in pattern:
                    # Purge endpoint requires a JSON body (PurgeRequest)
                    resp = test_client.request(
                        "DELETE", url, headers=test_client.auth_headers,
                        json={"confirm": False},
                    )
                else:
                    resp = test_client.delete(
                        url, headers=test_client.auth_headers,
                    )
                assert resp.status_code == 404, (
                    f"Expected 404 for {method} {url}, got {resp.status_code}"
                )


# --- Compose security scan edge cases ---


class TestComposeScanEdgeCases:

    def test_scan_rejects_cap_add_sys_admin(self, test_client, monkeypatch, tmp_path):
        """400 when compose adds SYS_ADMIN capability."""
        compose = "services:\n  svc:\n    image: test\n    cap_add:\n      - SYS_ADMIN\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "SYS_ADMIN" in resp.json()["detail"]

    def test_scan_rejects_pid_host(self, test_client, monkeypatch, tmp_path):
        """400 when compose uses pid: host."""
        compose = "services:\n  svc:\n    image: test\n    pid: host\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "host PID" in resp.json()["detail"]

    def test_scan_rejects_network_mode_host(self, test_client, monkeypatch, tmp_path):
        """400 when compose uses network_mode: host."""
        compose = "services:\n  svc:\n    image: test\n    network_mode: host\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "host network" in resp.json()["detail"]

    def test_scan_rejects_user_root(self, test_client, monkeypatch, tmp_path):
        """400 when compose runs as user: root."""
        compose = "services:\n  svc:\n    image: test\n    user: root\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "root" in resp.json()["detail"]

    def test_scan_rejects_user_0_colon_0(self, test_client, monkeypatch, tmp_path):
        """400 when compose runs as user: '0:0' (root bypass variant)."""
        compose = 'services:\n  svc:\n    image: test\n    user: "0:0"\n'
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "root" in resp.json()["detail"]

    def test_scan_rejects_absolute_host_path_mount(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose mounts an absolute host path."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    volumes:\n      - /etc/passwd:/etc/passwd:ro\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "absolute host path" in resp.json()["detail"]

    def test_scan_rejects_run_docker_sock(self, test_client, monkeypatch, tmp_path):
        """400 when compose mounts /run/docker.sock (variant path)."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    volumes:\n      - /run/docker.sock:/var/run/docker.sock\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "Docker socket mount" in resp.json()["detail"]

    def test_scan_rejects_bare_port_binding(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose uses bare host:container port binding."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    ports:\n      - '8080:80'\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "127.0.0.1" in resp.json()["detail"]

    def test_scan_allows_localhost_port_binding(
        self, test_client, monkeypatch, tmp_path,
    ):
        """Safe compose with 127.0.0.1 port binding passes scan."""
        compose = (
            "services:\n  svc:\n    image: test:latest\n"
            "    ports:\n      - '127.0.0.1:8080:80'\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "safe-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/safe-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 200

    def test_scan_rejects_0000_port_binding(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose binds to 0.0.0.0 explicitly."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    ports:\n      - '0.0.0.0:8080:80'\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "127.0.0.1" in resp.json()["detail"]

    def test_scan_rejects_core_service_name(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose service name collides with a core service."""
        compose = "services:\n  open-webui:\n    image: test:latest\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "conflicts with core service" in resp.json()["detail"]

    def test_scan_rejects_cap_add_sys_ptrace(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose adds SYS_PTRACE (expanded blocklist)."""
        compose = "services:\n  svc:\n    image: test\n    cap_add:\n      - SYS_PTRACE\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "SYS_PTRACE" in resp.json()["detail"]

    def test_scan_rejects_lowercase_cap(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose adds lowercase capability (case-insensitive check)."""
        compose = "services:\n  svc:\n    image: test\n    cap_add:\n      - sys_admin\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "dangerous capability" in resp.json()["detail"]

    def test_scan_rejects_ipc_host(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose uses ipc: host."""
        compose = "services:\n  svc:\n    image: test\n    ipc: host\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "host IPC" in resp.json()["detail"]

    def test_scan_rejects_userns_mode_host(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose uses userns_mode: host."""
        compose = "services:\n  svc:\n    image: test\n    userns_mode: host\n"
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "host user namespace" in resp.json()["detail"]

    def test_scan_rejects_named_volume_bind_mount(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when top-level volume uses driver_opts to bind-mount host path."""
        compose = (
            "services:\n  svc:\n    image: test:latest\n"
            "    volumes:\n      - mydata:/data\n"
            "volumes:\n  mydata:\n    driver_opts:\n"
            "      type: none\n      o: bind\n      device: /etc\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "bind-mount host path" in resp.json()["detail"]

    def test_scan_rejects_dict_port_without_localhost(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose uses dict-form port binding without 127.0.0.1."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    ports:\n      - target: 80\n        published: 8080\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "127.0.0.1" in resp.json()["detail"]

    def test_scan_rejects_bare_port_no_colon(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose uses bare port without colon (e.g. '8080')."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    ports:\n      - '8080'\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "bare port" in resp.json()["detail"]

    def test_scan_rejects_security_opt_equals_separator(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when compose uses security_opt with '=' separator."""
        compose = (
            "services:\n  svc:\n    image: test\n"
            "    security_opt:\n      - seccomp=unconfined\n"
        )
        lib_dir = _setup_library_ext(tmp_path, "bad-ext", compose_content=compose)
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "dangerous security_opt" in resp.json()["detail"]


# --- Size quota enforcement ---


class TestInstallSizeQuota:

    def test_install_rejects_oversized_extension(
        self, test_client, monkeypatch, tmp_path,
    ):
        """400 when extension exceeds 50MB size limit."""
        lib_dir = _setup_library_ext(tmp_path, "huge-ext")
        # Write a file that exceeds the limit
        big_file = lib_dir / "huge-ext" / "big.bin"
        big_file.write_bytes(b"\x00" * (50 * 1024 * 1024 + 1))
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/huge-ext/install",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "50MB" in resp.json()["detail"]


# --- Extension lifecycle status (stopped / health-based) ---


class TestExtensionLifecycleStatus:

    def test_user_extension_enabled_and_healthy(self, test_client, monkeypatch, tmp_path):
        """User extension with compose.yaml + healthy container → enabled."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml").write_text(_SAFE_COMPOSE)
        (ext_dir / "manifest.yaml").write_text(yaml.dump({
            "schema_version": "dream.services.v1",
            "service": {"id": "my-ext", "name": "My Ext", "port": 8080,
                         "health": "/health"},
        }))

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        mock_svc = _make_service_status("my-ext", "healthy")
        with patch("user_extensions.get_user_services_cached",
                   return_value={"my-ext": {"host": "my-ext", "port": 8080,
                                             "health": "/health", "name": "My Ext"}}):
            with patch("helpers.get_all_services", new_callable=AsyncMock,
                       return_value=[]):
                with patch("helpers.check_service_health", new_callable=AsyncMock,
                           return_value=mock_svc):
                    resp = test_client.get(
                        "/api/extensions/catalog",
                        headers=test_client.auth_headers,
                    )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["status"] == "enabled"

    def test_user_extension_enabled_but_unhealthy(self, test_client, monkeypatch, tmp_path):
        """User extension with compose.yaml + unhealthy container → stopped."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml").write_text(_SAFE_COMPOSE)
        (ext_dir / "manifest.yaml").write_text(yaml.dump({
            "schema_version": "dream.services.v1",
            "service": {"id": "my-ext", "name": "My Ext", "port": 8080,
                         "health": "/health"},
        }))

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        mock_svc = _make_service_status("my-ext", "down")
        with patch("user_extensions.get_user_services_cached",
                   return_value={"my-ext": {"host": "my-ext", "port": 8080,
                                             "health": "/health", "name": "My Ext"}}):
            with patch("helpers.get_all_services", new_callable=AsyncMock,
                       return_value=[]):
                with patch("helpers.check_service_health", new_callable=AsyncMock,
                           return_value=mock_svc):
                    resp = test_client.get(
                        "/api/extensions/catalog",
                        headers=test_client.auth_headers,
                    )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["status"] == "stopped"

    def test_user_extension_disabled_unchanged(self, test_client, monkeypatch, tmp_path):
        """User extension with compose.yaml.disabled → disabled (unchanged)."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml.disabled").write_text(_SAFE_COMPOSE)

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        with patch("user_extensions.get_user_services_cached",
                   return_value={}):
            with patch("helpers.get_all_services", new_callable=AsyncMock,
                       return_value=[]):
                resp = test_client.get(
                    "/api/extensions/catalog",
                    headers=test_client.auth_headers,
                )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["status"] == "disabled"

    def test_core_service_status_unchanged(self, test_client, monkeypatch, tmp_path):
        """Core service healthy → enabled, unhealthy → disabled (unchanged)."""
        catalog = [_make_catalog_ext("core-svc", "Core Service")]
        services = {"core-svc": {"host": "localhost", "port": 8080, "name": "Core"}}
        _patch_extensions_config(monkeypatch, catalog, services, tmp_path=tmp_path)

        mock_svc = _make_service_status("core-svc", "healthy")
        with patch("user_extensions.get_user_services_cached",
                   return_value={}):
            with patch("helpers.get_all_services", new_callable=AsyncMock,
                       return_value=[mock_svc]):
                resp = test_client.get(
                    "/api/extensions/catalog",
                    headers=test_client.auth_headers,
                )

        assert resp.status_code == 200
        ext = resp.json()["extensions"][0]
        assert ext["status"] == "enabled"

    def test_catalog_includes_user_extension_health(self, test_client, monkeypatch, tmp_path):
        """Catalog response includes 'stopped' in summary counts."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "compose.yaml").write_text(_SAFE_COMPOSE)

        catalog = [_make_catalog_ext("my-ext", "My Extension")]
        _patch_extensions_config(monkeypatch, catalog, tmp_path=tmp_path)
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)

        # No health data → stopped
        with patch("user_extensions.get_user_services_cached",
                   return_value={}):
            with patch("helpers.get_all_services", new_callable=AsyncMock,
                       return_value=[]):
                resp = test_client.get(
                    "/api/extensions/catalog",
                    headers=test_client.auth_headers,
                )

        assert resp.status_code == 200
        summary = resp.json()["summary"]
        assert summary["stopped"] == 1
        assert summary["installed"] == 1

    def test_enable_stopped_extension(self, test_client, monkeypatch, tmp_path):
        """Enable when compose.yaml exists (stopped) → starts without rename."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "enabled"
        # compose.yaml should still exist (not renamed)
        assert (user_dir / "my-ext" / "compose.yaml").exists()

    def test_enable_stopped_rejects_malicious_compose(self, test_client, monkeypatch, tmp_path):
        """Enable stopped ext with malicious compose.yaml → 400."""
        bad_compose = "services:\n  svc:\n    image: test\n    privileged: true\n"
        user_dir = tmp_path / "user"
        user_dir.mkdir(exist_ok=True)
        ext_dir = user_dir / "bad-ext"
        ext_dir.mkdir(exist_ok=True)
        (ext_dir / "compose.yaml").write_text(bad_compose)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/bad-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "privileged" in resp.json()["detail"]


# --- Symlink handling ---


class TestSymlinkHandling:

    def test_copytree_safe_skips_symlinks(self, tmp_path):
        """_copytree_safe skips symlinks in source directory."""
        from routers.extensions import _copytree_safe

        src = tmp_path / "src"
        src.mkdir()
        (src / "real.txt").write_text("real content")
        (src / "link.txt").symlink_to(src / "real.txt")

        dst = tmp_path / "dst"
        _copytree_safe(src, dst)

        assert (dst / "real.txt").exists()
        assert not (dst / "link.txt").exists()

    def test_enable_stopped_rejects_symlinked_compose(
        self, test_client, monkeypatch, tmp_path,
    ):
        """Enable stopped ext rejects a compose.yaml that is a symlink."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        # Create a real file and symlink compose.yaml to it
        real_compose = tmp_path / "real-compose.yaml"
        real_compose.write_text(_SAFE_COMPOSE)
        (ext_dir / "compose.yaml").symlink_to(real_compose)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "symlink" in resp.json()["detail"]

    def test_enable_rejects_symlinked_compose(
        self, test_client, monkeypatch, tmp_path,
    ):
        """Enable rejects a compose.yaml.disabled that is a symlink."""
        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext"
        ext_dir.mkdir(parents=True)
        # Create a real file and symlink the .disabled to it
        real_compose = tmp_path / "real-compose.yaml"
        real_compose.write_text(_SAFE_COMPOSE)
        (ext_dir / "compose.yaml.disabled").symlink_to(real_compose)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/enable",
            headers=test_client.auth_headers,
        )
        assert resp.status_code == 400
        assert "symlink" in resp.json()["detail"]


# --- Purge extension data ---


class TestPurgeExtensionData:

    def test_purge_happy_path(self, test_client, monkeypatch, tmp_path):
        """Purge succeeds for disabled extension with existing data dir."""
        _patch_mutation_config(monkeypatch, tmp_path)
        data_dir = tmp_path / "my-ext"
        data_dir.mkdir()
        (data_dir / "some-file.db").write_text("data")

        with patch("routers.extensions._extensions_lock", return_value=contextlib.nullcontext()), \
             patch("helpers.dir_size_gb", return_value=1.5):
            resp = test_client.request(
                "DELETE", "/api/extensions/my-ext/data",
                headers=test_client.auth_headers,
                json={"confirm": True},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "my-ext"
        assert data["action"] == "purged"
        assert data["size_gb_freed"] == 1.5
        assert not data_dir.exists()

    def test_purge_unlinks_progress_file(self, test_client, monkeypatch, tmp_path):
        """Purge also deletes the per-service install-progress entry so the UI
        does not keep showing a stale 'installing' status."""
        _patch_mutation_config(monkeypatch, tmp_path)
        data_dir = tmp_path / "my-ext"
        data_dir.mkdir()
        (data_dir / "some-file.db").write_text("data")
        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        progress_file = progress_dir / "my-ext.json"
        progress_file.write_text(
            '{"service_id": "my-ext", "status": "started",'
            ' "phase_label": "stale", "error": null,'
            ' "started_at": "2026-04-10T00:00:00+00:00",'
            ' "updated_at": "2026-04-10T00:00:00+00:00"}'
        )

        with patch("routers.extensions._extensions_lock", return_value=contextlib.nullcontext()), \
             patch("helpers.dir_size_gb", return_value=0.1):
            resp = test_client.request(
                "DELETE", "/api/extensions/my-ext/data",
                headers=test_client.auth_headers,
                json={"confirm": True},
            )

        assert resp.status_code == 200
        assert not progress_file.exists(), "purge must unlink the progress file"

    def test_purge_400_when_enabled_builtin(self, test_client, monkeypatch, tmp_path):
        """400 when extension is still enabled (compose.yaml in built-in dir)."""
        _patch_mutation_config(monkeypatch, tmp_path)
        # Create compose.yaml in the built-in extensions dir
        builtin_dir = tmp_path / "builtin" / "my-ext"
        builtin_dir.mkdir(parents=True)
        (builtin_dir / "compose.yaml").write_text("version: '3'")
        # Also need a data dir to get past later checks
        data_dir = tmp_path / "my-ext"
        data_dir.mkdir()

        with patch("routers.extensions._extensions_lock", return_value=contextlib.nullcontext()):
            resp = test_client.request(
                "DELETE", "/api/extensions/my-ext/data",
                headers=test_client.auth_headers,
                json={"confirm": True},
            )

        assert resp.status_code == 400
        assert "still enabled" in resp.json()["detail"]

    def test_purge_400_when_enabled_user(self, test_client, monkeypatch, tmp_path):
        """400 when extension is still enabled (compose.yaml in user dir)."""
        user_dir = _setup_user_ext(tmp_path, "my-ext", enabled=True)
        _patch_mutation_config(monkeypatch, tmp_path, user_dir=user_dir)

        with patch("routers.extensions._extensions_lock", return_value=contextlib.nullcontext()):
            resp = test_client.request(
                "DELETE", "/api/extensions/my-ext/data",
                headers=test_client.auth_headers,
                json={"confirm": True},
            )

        assert resp.status_code == 400
        assert "still enabled" in resp.json()["detail"]

    def test_purge_403_core_service(self, test_client, monkeypatch, tmp_path):
        """403 when trying to purge a core service."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.request(
            "DELETE", "/api/extensions/open-webui/data",
            headers=test_client.auth_headers,
            json={"confirm": True},
        )

        assert resp.status_code == 403
        assert "core service" in resp.json()["detail"].lower()

    def test_purge_404_invalid_id(self, test_client, monkeypatch, tmp_path):
        """404 for service_id that fails regex validation."""
        _patch_mutation_config(monkeypatch, tmp_path)

        for bad_id in ["..etc", ".hidden", "UPPERCASE", "-starts-dash"]:
            resp = test_client.request(
                "DELETE", f"/api/extensions/{bad_id}/data",
                headers=test_client.auth_headers,
                json={"confirm": True},
            )
            assert resp.status_code == 404, f"Expected 404 for: {bad_id}"

    def test_purge_404_no_data_dir(self, test_client, monkeypatch, tmp_path):
        """404 when valid ID but no data directory exists."""
        _patch_mutation_config(monkeypatch, tmp_path)

        with patch("routers.extensions._extensions_lock", return_value=contextlib.nullcontext()):
            resp = test_client.request(
                "DELETE", "/api/extensions/my-ext/data",
                headers=test_client.auth_headers,
                json={"confirm": True},
            )

        assert resp.status_code == 404
        assert "No data directory" in resp.json()["detail"]

    def test_purge_400_confirm_false(self, test_client, monkeypatch, tmp_path):
        """400 when data exists but confirm is false."""
        _patch_mutation_config(monkeypatch, tmp_path)
        data_dir = tmp_path / "my-ext"
        data_dir.mkdir()

        with patch("routers.extensions._extensions_lock", return_value=contextlib.nullcontext()):
            resp = test_client.request(
                "DELETE", "/api/extensions/my-ext/data",
                headers=test_client.auth_headers,
                json={"confirm": False},
            )

        assert resp.status_code == 400
        assert "Confirmation required" in resp.json()["detail"]
        # Data dir should still exist
        assert data_dir.exists()

    def test_purge_path_traversal(self, test_client, monkeypatch, tmp_path):
        """Path traversal attempts are blocked by regex or path check."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.request(
            "DELETE", "/api/extensions/..%2fetc/data",
            headers=test_client.auth_headers,
            json={"confirm": True},
        )
        # Should fail at regex or Starlette routing level
        assert resp.status_code in (404, 422)

    def test_purge_requires_auth(self, test_client):
        """DELETE /api/extensions/{id}/data without auth → 401."""
        resp = test_client.request(
            "DELETE", "/api/extensions/my-ext/data",
            json={"confirm": True},
        )
        assert resp.status_code == 401


# --- Orphaned storage ---


class TestOrphanedStorage:

    def test_orphaned_requires_auth(self, test_client):
        """GET /api/storage/orphaned without auth → 401."""
        resp = test_client.get("/api/storage/orphaned")
        assert resp.status_code == 401

    def test_orphaned_empty_data_dir(self, test_client, monkeypatch, tmp_path):
        """Empty data dir returns empty orphaned list."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        monkeypatch.setattr("routers.extensions.DATA_DIR", str(data_dir))
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        resp = test_client.get(
            "/api/storage/orphaned",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["orphaned"] == []
        assert data["total_gb"] == 0

    def test_orphaned_nonexistent_data_dir(self, test_client, monkeypatch, tmp_path):
        """Non-existent data dir returns empty orphaned list."""
        monkeypatch.setattr("routers.extensions.DATA_DIR",
                            str(tmp_path / "nonexistent"))
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        resp = test_client.get(
            "/api/storage/orphaned",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["orphaned"] == []
        assert data["total_gb"] == 0

    def test_orphaned_excludes_known_services(self, test_client, monkeypatch, tmp_path):
        """Dirs matching SERVICES keys are not listed as orphaned."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "known-svc").mkdir()
        monkeypatch.setattr("routers.extensions.DATA_DIR", str(data_dir))
        monkeypatch.setattr("routers.extensions.SERVICES",
                            {"known-svc": {"host": "localhost", "port": 8080}})

        with patch("helpers.dir_size_gb", return_value=2.0):
            resp = test_client.get(
                "/api/storage/orphaned",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["orphaned"] == []
        assert data["total_gb"] == 0

    def test_orphaned_excludes_system_dirs(self, test_client, monkeypatch, tmp_path):
        """System dirs (models, config, etc.) are not listed as orphaned."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        for name in ("models", "config", "user-extensions", "extensions-library"):
            (data_dir / name).mkdir()
        monkeypatch.setattr("routers.extensions.DATA_DIR", str(data_dir))
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        with patch("helpers.dir_size_gb", return_value=1.0):
            resp = test_client.get(
                "/api/storage/orphaned",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["orphaned"] == []
        assert data["total_gb"] == 0

    def test_orphaned_includes_unknown_dirs(self, test_client, monkeypatch, tmp_path):
        """Dirs not in SERVICES or system_dirs are listed as orphaned."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "mystery-data").mkdir()
        (data_dir / "leftover-ext").mkdir()
        monkeypatch.setattr("routers.extensions.DATA_DIR", str(data_dir))
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        with patch("helpers.dir_size_gb", return_value=3.0):
            resp = test_client.get(
                "/api/storage/orphaned",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["orphaned"]) == 2
        names = [o["name"] for o in data["orphaned"]]
        assert "mystery-data" in names
        assert "leftover-ext" in names
        assert data["orphaned"][0]["size_gb"] == 3.0
        assert data["total_gb"] == 6.0

    def test_orphaned_skips_files(self, test_client, monkeypatch, tmp_path):
        """Regular files in data dir are not listed."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "some-file.txt").write_text("not a directory")
        (data_dir / "orphan-dir").mkdir()
        monkeypatch.setattr("routers.extensions.DATA_DIR", str(data_dir))
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        with patch("helpers.dir_size_gb", return_value=0.5):
            resp = test_client.get(
                "/api/storage/orphaned",
                headers=test_client.auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["orphaned"]) == 1
        assert data["orphaned"][0]["name"] == "orphan-dir"
        assert data["total_gb"] == 0.5

# --- Install progress tracking ---


class TestInstallProgress:

    def test_progress_endpoint_no_progress(self, test_client, monkeypatch, tmp_path):
        """GET progress when no file exists → idle."""
        _patch_mutation_config(monkeypatch, tmp_path)

        resp = test_client.get(
            "/api/extensions/my-ext/progress",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["service_id"] == "my-ext"
        assert data["status"] == "idle"

    def test_progress_endpoint_during_install(self, test_client, monkeypatch, tmp_path):
        """GET progress with active progress file → returns data."""
        _patch_mutation_config(monkeypatch, tmp_path)

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        progress_data = {
            "service_id": "my-ext",
            "status": "pulling",
            "phase_label": "Downloading image...",
            "error": None,
            "started_at": "2026-04-06T10:00:00+00:00",
            "updated_at": "2026-04-06T10:00:05+00:00",
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        resp = test_client.get(
            "/api/extensions/my-ext/progress",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pulling"
        assert data["phase_label"] == "Downloading image..."

    def test_status_installing_when_progress_pulling(self, monkeypatch, tmp_path):
        """Progress file with status 'pulling' → _compute_extension_status returns 'installing'."""
        from routers.extensions import _compute_extension_status

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", tmp_path / "user")
        monkeypatch.setattr("routers.extensions.GPU_BACKEND", "nvidia")
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        progress_data = {
            "service_id": "my-ext",
            "status": "pulling",
            "phase_label": "Downloading image...",
            "error": None,
            "started_at": now,
            "updated_at": now,
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        ext = _make_catalog_ext("my-ext")
        status = _compute_extension_status(ext, {})
        assert status == "installing"

    def test_status_installing_when_progress_starting(self, monkeypatch, tmp_path):
        """Progress file with status 'starting' → _compute_extension_status returns 'installing'."""
        from routers.extensions import _compute_extension_status

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", tmp_path / "user")
        monkeypatch.setattr("routers.extensions.GPU_BACKEND", "nvidia")
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        progress_data = {
            "service_id": "my-ext",
            "status": "starting",
            "phase_label": "Starting container...",
            "error": None,
            "started_at": now,
            "updated_at": now,
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        ext = _make_catalog_ext("my-ext")
        status = _compute_extension_status(ext, {})
        assert status == "installing"

    def test_status_setting_up_when_progress_setup_hook(self, monkeypatch, tmp_path):
        """Progress file with status 'setup_hook' → returns 'setting_up'."""
        from routers.extensions import _compute_extension_status

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", tmp_path / "user")
        monkeypatch.setattr("routers.extensions.GPU_BACKEND", "nvidia")
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        progress_data = {
            "service_id": "my-ext",
            "status": "setup_hook",
            "phase_label": "Running setup...",
            "error": None,
            "started_at": now,
            "updated_at": now,
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        ext = _make_catalog_ext("my-ext")
        status = _compute_extension_status(ext, {})
        assert status == "setting_up"

    def test_status_error_when_progress_error(self, monkeypatch, tmp_path):
        """Progress file with status 'error' → returns 'error'."""
        from routers.extensions import _compute_extension_status

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))
        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", tmp_path / "user")
        monkeypatch.setattr("routers.extensions.GPU_BACKEND", "nvidia")
        monkeypatch.setattr("routers.extensions.SERVICES", {})

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        progress_data = {
            "service_id": "my-ext",
            "status": "error",
            "phase_label": "Installation failed",
            "error": "something went wrong",
            "started_at": now,
            "updated_at": now,
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        ext = _make_catalog_ext("my-ext")
        status = _compute_extension_status(ext, {})
        assert status == "error"

    def test_stale_progress_ignored(self, monkeypatch, tmp_path):
        """Progress file >1 hour old → _read_progress returns None."""
        from routers.extensions import _read_progress

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        # Set updated_at to far in the past (well over 1 hour)
        progress_data = {
            "service_id": "my-ext",
            "status": "pulling",
            "phase_label": "Downloading image...",
            "error": None,
            "started_at": "2020-01-01T00:00:00+00:00",
            "updated_at": "2020-01-01T00:00:00+00:00",
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        result = _read_progress("my-ext")
        assert result is None

    def test_stale_error_progress_preserved(self, monkeypatch, tmp_path):
        """Stale progress file with status 'error' → _read_progress still returns it (not None)."""
        from routers.extensions import _read_progress

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        progress_data = {
            "service_id": "my-ext",
            "status": "error",
            "phase_label": "Installation failed",
            "error": "something went wrong",
            "started_at": "2020-01-01T00:00:00+00:00",
            "updated_at": "2020-01-01T00:00:00+00:00",
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        result = _read_progress("my-ext")
        assert result is not None
        assert result["status"] == "error"

    def test_progress_cleanup_removes_old_started(self, monkeypatch, tmp_path):
        """_cleanup_stale_progress() removes 'started' files >15 min old."""
        from routers.extensions import _cleanup_stale_progress

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))

        progress_dir = tmp_path / "extension-progress"
        progress_dir.mkdir()
        progress_data = {
            "service_id": "my-ext",
            "status": "started",
            "phase_label": "Service started",
            "error": None,
            "started_at": "2020-01-01T00:00:00+00:00",
            "updated_at": "2020-01-01T00:00:00+00:00",
        }
        (progress_dir / "my-ext.json").write_text(json.dumps(progress_data))

        _cleanup_stale_progress()

        assert not (progress_dir / "my-ext.json").exists()

    def test_install_returns_progress_endpoint(self, test_client, monkeypatch, tmp_path):
        """Install response includes progress_endpoint field."""
        lib_dir = _setup_library_ext(tmp_path, "my-ext")
        _patch_mutation_config(monkeypatch, tmp_path, lib_dir=lib_dir)

        resp = test_client.post(
            "/api/extensions/my-ext/install",
            headers=test_client.auth_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["progress_endpoint"] == "/api/extensions/my-ext/progress"


# --- Config sync ---


class TestSyncExtensionConfig:

    def test_copies_config_subdir_to_install_dir(self, monkeypatch, tmp_path):
        """Config subdir is synced to INSTALL_DIR/config/ after install."""
        from routers.extensions import _sync_extension_config

        user_dir = tmp_path / "user"
        ext_dir = user_dir / "my-ext" / "config" / "my-ext"
        ext_dir.mkdir(parents=True)
        (ext_dir / "nginx.conf").write_text("server {}")
        (ext_dir / "entrypoint.sh").write_text("#!/bin/sh\necho hi")

        install_dir = tmp_path / "install"
        install_dir.mkdir()

        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)
        monkeypatch.setattr("routers.extensions.INSTALL_DIR", str(install_dir))

        _sync_extension_config("my-ext")

        target = install_dir / "config" / "my-ext"
        assert (target / "nginx.conf").exists()
        assert (target / "nginx.conf").read_text() == "server {}"
        # .sh files should be executable
        import stat
        mode = (target / "entrypoint.sh").stat().st_mode
        assert mode & stat.S_IXUSR

    def test_noop_when_no_config_dir(self, monkeypatch, tmp_path):
        """No crash when extension has no config/ subdirectory."""
        from routers.extensions import _sync_extension_config

        user_dir = tmp_path / "user"
        (user_dir / "my-ext").mkdir(parents=True)

        monkeypatch.setattr("routers.extensions.USER_EXTENSIONS_DIR", user_dir)
        monkeypatch.setattr("routers.extensions.INSTALL_DIR", str(tmp_path))

        _sync_extension_config("my-ext")  # should not raise


# --- Error progress ---


class TestWriteErrorProgress:

    def test_sets_error_status_on_existing_progress(self, monkeypatch, tmp_path):
        """Error progress overwrites status but preserves started_at."""
        from routers.extensions import _write_initial_progress, _write_error_progress

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))

        _write_initial_progress("my-ext")
        progress_file = tmp_path / "extension-progress" / "my-ext.json"
        initial = json.loads(progress_file.read_text())
        assert initial["status"] == "pulling"

        _write_error_progress("my-ext", "Host agent failed")
        updated = json.loads(progress_file.read_text())
        assert updated["status"] == "error"
        assert updated["error"] == "Host agent failed"
        assert updated["started_at"] == initial["started_at"]

    def test_creates_error_file_when_no_prior_progress(self, monkeypatch, tmp_path):
        """Error progress can be written even without prior progress file."""
        from routers.extensions import _write_error_progress

        monkeypatch.setattr("routers.extensions.DATA_DIR", str(tmp_path))

        _write_error_progress("my-ext", "Agent unreachable")
        progress_file = tmp_path / "extension-progress" / "my-ext.json"
        data = json.loads(progress_file.read_text())
        assert data["status"] == "error"
        assert data["error"] == "Agent unreachable"
        assert "phase_label" in data
