"""Focused tests for the models router helpers."""

from __future__ import annotations

import importlib
import sys
import types


def test_get_gpu_vram_returns_none_on_nvml_error(monkeypatch):
    """Operational NVML failures should degrade to unknown GPU rather than 500."""

    class FakeNVMLError(Exception):
        pass

    def _raise_nvml_error():
        raise FakeNVMLError("driver not loaded")

    real_gpu = sys.modules.get("gpu")
    real_pynvml = sys.modules.get("pynvml")

    monkeypatch.setitem(sys.modules, "gpu", types.SimpleNamespace(get_gpu_info=_raise_nvml_error))
    monkeypatch.setitem(sys.modules, "pynvml", types.SimpleNamespace(NVMLError=FakeNVMLError))

    import routers.models as models_router

    importlib.reload(models_router)
    assert models_router._get_gpu_vram() is None

    if real_gpu is None:
        monkeypatch.delitem(sys.modules, "gpu", raising=False)
    else:
        monkeypatch.setitem(sys.modules, "gpu", real_gpu)

    if real_pynvml is None:
        monkeypatch.delitem(sys.modules, "pynvml", raising=False)
    else:
        monkeypatch.setitem(sys.modules, "pynvml", real_pynvml)

    importlib.reload(models_router)
