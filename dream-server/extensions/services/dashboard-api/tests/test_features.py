"""Tests for features.py — calculate_feature_status with Apple Silicon fallback."""

import os
from unittest.mock import patch, AsyncMock


class TestCalculateFeatureStatusAppleFallback:

    def _make_feature(self, vram_gb=0):
        return {
            "id": "test-feat",
            "name": "Test Feature",
            "description": "A test feature",
            "icon": "Zap",
            "category": "inference",
            "setup_time": "5 min",
            "priority": 1,
            "requirements": {
                "vram_gb": vram_gb,
                "services": [],
                "services_any": [],
            },
            "enabled_services_all": ["required-svc"],
            "enabled_services_any": [],
        }

    def test_apple_fallback_uses_host_ram_when_gpu_info_none(self):
        """When GPU_BACKEND=apple and gpu_info is None, HOST_RAM_GB gates VRAM."""
        from routers.features import calculate_feature_status
        feature = self._make_feature(vram_gb=16)
        with patch.dict(os.environ, {"HOST_RAM_GB": "24", "GPU_BACKEND": "apple"}):
            with patch("routers.features.GPU_BACKEND", "apple"):
                result = calculate_feature_status(feature, [], None)
        assert result["requirements"]["vramOk"] is True
        assert result["status"] != "insufficient_vram"

    def test_apple_fallback_insufficient_when_ram_too_low(self):
        """When HOST_RAM_GB < feature vram_gb, feature is insufficient_vram."""
        from routers.features import calculate_feature_status
        feature = self._make_feature(vram_gb=32)
        with patch.dict(os.environ, {"HOST_RAM_GB": "16", "GPU_BACKEND": "apple"}):
            with patch("routers.features.GPU_BACKEND", "apple"):
                result = calculate_feature_status(feature, [], None)
        assert result["requirements"]["vramOk"] is False
        assert result["status"] == "insufficient_vram"

    def test_apple_fallback_not_triggered_on_linux(self):
        """HOST_RAM fallback does NOT apply on non-apple backends."""
        from routers.features import calculate_feature_status
        feature = self._make_feature(vram_gb=8)
        with patch.dict(os.environ, {"HOST_RAM_GB": "64", "GPU_BACKEND": "nvidia"}):
            with patch("routers.features.GPU_BACKEND", "nvidia"):
                result = calculate_feature_status(feature, [], None)
        # gpu_info is None, so gpu_vram_gb=0, which is < 8 → insufficient_vram on nvidia
        assert result["status"] == "insufficient_vram"


class TestApiFeaturesAppleFallback:
    """Tests for the endpoint-level Apple Silicon VRAM fallback in api_features()."""

    def test_api_features_apple_fallback_gpu_summary(self, test_client):
        """api_features() endpoint applies Apple Silicon HOST_RAM_GB fallback for GPU summary."""
        with patch.dict(os.environ, {"HOST_RAM_GB": "16", "GPU_BACKEND": "apple"}):
            with patch("routers.features.GPU_BACKEND", "apple"):
                with patch("routers.features.get_gpu_info", return_value=None):
                    with patch("helpers.get_all_services", new_callable=AsyncMock, return_value=[]):
                        response = test_client.get(
                            "/api/features",
                            headers=test_client.auth_headers,
                        )
        assert response.status_code == 200
        data = response.json()
        assert data["gpu"]["vramGb"] == 16.0
