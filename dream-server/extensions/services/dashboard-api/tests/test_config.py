"""Tests for config.py — manifest loading and service discovery."""

import logging

import pytest

import json

import pytest

from config import _read_manifest_file, load_extension_manifests


def _feature_yaml(
    service_id: str, feature_id: str, name: str, gpu_backends: str | None
) -> str:
    lines = [
        f"  - id: {feature_id}",
        f"    name: {name}",
        f"    description: {name} description",
        "    icon: Zap",
        "    category: inference",
        "    requirements:",
        f"      services: [{service_id}]",
        f"    enabled_services_all: [{service_id}]",
        "    setup_time: fast",
        "    priority: 1",
    ]
    if gpu_backends is not None:
        lines.append(f"    gpu_backends: {gpu_backends}")
    return "\n".join(lines) + "\n"


def _service_manifest(
    *,
    service_id: str,
    service_name: str,
    port: int = 80,
    service_type: str = "docker",
    gpu_backends: str = "[amd, nvidia]",
    category: str = "core",
    features: str = "",
) -> str:
    env_key = f"{service_id.upper().replace('-', '_')}_PORT"
    lines = [
        "schema_version: dream.services.v1",
        "service:",
        f"  id: {service_id}",
        f"  name: {service_name}",
        "  aliases: []",
        f"  container_name: dream-{service_id}",
        f"  default_host: {service_id}",
        f"  port: {port}",
        f"  external_port_env: {env_key}",
        f"  external_port_default: {port}",
        "  health: /health",
        f"  type: {service_type}",
        f"  gpu_backends: {gpu_backends}",
        f"  category: {category}",
        "  depends_on: []",
    ]
    if features:
        lines.append("features:")
        lines.extend(features.rstrip("\n").splitlines())
    return "\n".join(lines) + "\n"


VALID_MANIFEST = _service_manifest(
    service_id="test-service",
    service_name="Test Service",
    port=8080,
    features=_feature_yaml("test-service", "test-feature", "Test Feature", "[amd, nvidia]"),
)


class TestReadManifestFile:

    def test_reads_yaml(self, tmp_path):
        f = tmp_path / "manifest.yaml"
        f.write_text(VALID_MANIFEST)
        data = _read_manifest_file(f)
        assert data["schema_version"] == "dream.services.v1"
        assert data["service"]["id"] == "test-service"

    def test_reads_json(self, tmp_path):
        f = tmp_path / "manifest.json"
        f.write_text(
            json.dumps(
                {
                    "schema_version": "dream.services.v1",
                    "service": {"id": "json-svc", "name": "JSON", "port": 9090},
                }
            )
        )
        data = _read_manifest_file(f)
        assert data["service"]["id"] == "json-svc"

    def test_rejects_non_dict_root(self, tmp_path):
        f = tmp_path / "manifest.yaml"
        f.write_text("- just\n- a\n- list\n")
        with pytest.raises(ValueError, match="object"):
            _read_manifest_file(f)


class TestLoadExtensionManifests:

    def test_loads_valid_manifest(self, tmp_path):
        svc_dir = tmp_path / "test-service"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(VALID_MANIFEST)

        services, features, _ = load_extension_manifests(tmp_path, "nvidia")
        assert "test-service" in services
        assert services["test-service"]["port"] == 8080
        assert services["test-service"]["name"] == "Test Service"
        assert services["test-service"]["health"] == "/health"
        assert services["test-service"]["category"] == "core"
        assert len(features) == 1
        assert features[0]["id"] == "test-feature"

    def test_skips_wrong_schema_version(self, tmp_path):
        svc_dir = tmp_path / "old-service"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            "schema_version: dream.services.v0\nservice:\n  id: old\n  port: 80\n"
        )

        services, features, errors = load_extension_manifests(tmp_path, "nvidia")
        assert len(services) == 0
        assert len(errors) == 1
        assert "Unsupported schema_version" in errors[0]["error"]

    def test_filters_by_gpu_backend(self, tmp_path):
        svc_dir = tmp_path / "nvidia-only"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="nvidia-only",
                service_name="NVIDIA Only",
                gpu_backends="[nvidia]",
            )
        )

        services, _, _ = load_extension_manifests(tmp_path, "amd")
        assert len(services) == 0

        services, _, _ = load_extension_manifests(tmp_path, "nvidia")
        assert "nvidia-only" in services

    def test_empty_directory(self, tmp_path):
        services, features, _ = load_extension_manifests(tmp_path, "nvidia")
        assert services == {}
        assert features == []

    def test_nonexistent_directory(self, tmp_path):
        missing = tmp_path / "does-not-exist"
        services, features, _ = load_extension_manifests(missing, "nvidia")
        assert services == {}
        assert features == []

    def test_features_filtered_by_gpu(self, tmp_path):
        svc_dir = tmp_path / "mixed"
        svc_dir.mkdir()
        features = _feature_yaml("mixed", "amd-feat", "AMD Feature", "[amd]") + _feature_yaml(
            "mixed", "both-feat", "Both Feature", "[amd, nvidia]"
        )
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="mixed",
                service_name="Mixed",
                gpu_backends="[amd, nvidia]",
                features=features,
            )
        )

        _, features, _ = load_extension_manifests(tmp_path, "nvidia")
        feature_ids = [f["id"] for f in features]
        assert "both-feat" in feature_ids
        assert "amd-feat" not in feature_ids

    def test_apple_backend_discovers_services_without_explicit_list(self, tmp_path):
        """Services with no gpu_backends key default to [amd, nvidia, apple]."""
        svc_dir = tmp_path / "generic-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            "schema_version: dream.services.v1\n"
            "service:\n  id: generic-svc\n  name: Generic\n  port: 80\n"
        )

        services, _, _ = load_extension_manifests(tmp_path, "apple")
        assert "generic-svc" in services

    def test_apple_backend_filtered_by_explicit_nvidia_amd_list(self, tmp_path):
        """Docker service explicitly listing [amd, nvidia] is still loaded for apple backend."""
        svc_dir = tmp_path / "gpu-only-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="gpu-only-svc",
                service_name="GPU Only",
                gpu_backends="[amd, nvidia]",
            )
        )

        services, _, _ = load_extension_manifests(tmp_path, "apple")
        assert "gpu-only-svc" in services

    def test_apple_backend_discovers_service_explicitly_listing_apple(self, tmp_path):
        """Service listing apple in gpu_backends is discovered for apple backend."""
        svc_dir = tmp_path / "apple-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="apple-svc",
                service_name="Apple Svc",
                gpu_backends="[amd, nvidia, apple]",
            )
        )

        services, _, _ = load_extension_manifests(tmp_path, "apple")
        assert "apple-svc" in services

    def test_apple_backend_feature_default_discovered(self, tmp_path):
        """Features with no gpu_backends key default to include apple."""
        svc_dir = tmp_path / "svc-with-feature"
        svc_dir.mkdir()
        feature_block = _feature_yaml("svc-with-feature", "default-feat", "Default Feature", None)
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="svc-with-feature",
                service_name="Svc",
                features=feature_block,
            )
        )

        _, features, _ = load_extension_manifests(tmp_path, "apple")
        assert any(f["id"] == "default-feat" for f in features)

    def test_apple_backend_excludes_host_systemd(self, tmp_path):
        """Services with type: host-systemd are excluded on apple backend."""
        svc_dir = tmp_path / "systemd-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="systemd-svc",
                service_name="Systemd Svc",
                service_type="host-systemd",
            )
        )

        services, _, _ = load_extension_manifests(tmp_path, "apple")
        assert "systemd-svc" not in services

    def test_apple_backend_loads_all_features(self, tmp_path):
        """Features with gpu_backends: [amd, nvidia] are loaded for apple backend."""
        svc_dir = tmp_path / "svc-with-gpu-feature"
        svc_dir.mkdir()
        feature_block = _feature_yaml(
            "svc-with-gpu-feature", "gpu-feat", "GPU Feature", "[amd, nvidia]"
        )
        (svc_dir / "manifest.yaml").write_text(
            _service_manifest(
                service_id="svc-with-gpu-feature",
                service_name="Svc",
                features=feature_block,
            )
        )

        _, features, _ = load_extension_manifests(tmp_path, "apple")
        assert any(f["id"] == "gpu-feat" for f in features)

    def test_warns_on_missing_optional_feature_fields(self, tmp_path, caplog):
        """A feature missing optional fields is loaded but a warning is logged."""
        svc_dir = tmp_path / "sparse-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            "schema_version: dream.services.v1\n"
            "service:\n  id: sparse-svc\n  name: Sparse\n  port: 80\n"
            "features:\n"
            "  - id: sparse-feat\n    name: Sparse Feature\n"
        )

        with caplog.at_level(logging.WARNING, logger="config"):
            _, features, _ = load_extension_manifests(tmp_path, "nvidia")

        assert any(f["id"] == "sparse-feat" for f in features)
        warning_msgs = [r.message for r in caplog.records if "missing optional fields" in r.message]
        assert len(warning_msgs) == 1
        assert "sparse-feat" in warning_msgs[0]
        for field in ("description", "icon", "category", "setup_time", "priority"):
            assert field in warning_msgs[0]

    def test_collects_parse_errors(self, tmp_path):
        svc_dir = tmp_path / "broken-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text("invalid: yaml: [unterminated")

        services, features, errors = load_extension_manifests(tmp_path, "nvidia")
        assert len(errors) == 1
        assert "file" in errors[0]
        assert "error" in errors[0]
        assert "broken-svc" in errors[0]["file"]
        assert services == {}
        assert features == []

    def test_collects_error_for_missing_service_id(self, tmp_path):
        """A manifest with a valid schema but no service.id collects an error."""
        svc_dir = tmp_path / "no-id-svc"
        svc_dir.mkdir()
        (svc_dir / "manifest.yaml").write_text(
            "schema_version: dream.services.v1\n"
            "service:\n  name: No ID\n  port: 80\n"
        )

        services, features, errors = load_extension_manifests(tmp_path, "nvidia")
        assert len(errors) == 1
        assert "service.id is required" in errors[0]["error"]
        assert "no-id-svc" in errors[0]["file"]
        assert services == {}
