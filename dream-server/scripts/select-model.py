#!/usr/bin/env python3
"""Select a pre-download DreamServer model from config/model-library.json.

This script is intentionally offline and deterministic. It only uses the
installer's detected hardware envelope plus the versioned model catalog; it
does not download GGUF metadata and it never treats catalog tok/s estimates as
measured performance.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from pathlib import Path
from typing import Any


VRAM_FIT_TOLERANCE_GB = 0.25
POLICY = "context-aware-largest-capable-general-v1"


def normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def normalize_profile(value: str | None) -> str:
    key = normalize_key(value or "qwen")
    if key in {"gemma", "gemma4", "gemma-4"}:
        return "gemma4"
    if key == "auto":
        return "auto"
    return "qwen"


def effective_profile(profile: str, backend: str, tier: str) -> str:
    if profile != "auto":
        return profile
    if normalize_key(tier) in {"cloud", "0", "t0"}:
        return "qwen"
    return "gemma4" if normalize_key(backend) in {"apple", "nvidia", "sycl"} else "qwen"


def normalize_model(raw: dict[str, Any]) -> dict[str, Any] | None:
    gguf_parts = raw.get("gguf_parts") if isinstance(raw.get("gguf_parts"), list) else []
    gguf = raw.get("gguf") or raw.get("gguf_file")
    if not gguf and gguf_parts and isinstance(gguf_parts[0], dict):
        gguf = gguf_parts[0].get("file")
    model_id = raw.get("id") or raw.get("llm_model_name") or raw.get("name") or gguf
    if not model_id or not gguf:
        return None
    try:
        size_mb = float(raw.get("size_mb") or 0)
    except (TypeError, ValueError):
        size_mb = 0.0
    try:
        vram_required = float(raw.get("vram_required_gb") or 0)
    except (TypeError, ValueError):
        vram_required = 0.0
    try:
        context_length = int(raw.get("context_length") or 0)
    except (TypeError, ValueError):
        context_length = 0
    return {
        "id": str(model_id),
        "name": raw.get("name") or str(model_id),
        "family": raw.get("family") or "",
        "llm_model_name": raw.get("llm_model_name") or str(model_id),
        "gguf_file": str(gguf),
        "gguf_url": raw.get("gguf_url") or "",
        "gguf_sha256": raw.get("gguf_sha256") or "",
        "gguf_parts": gguf_parts,
        "size_mb": size_mb,
        "vram_required_gb": vram_required,
        "context_length": context_length,
        "quantization": raw.get("quantization") or "",
        "specialty": raw.get("specialty") or "General",
        "llama_server_image": raw.get("llama_server_image") or "",
    }


def load_catalog(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return [
        model for model in (normalize_model(raw) for raw in data.get("models", []))
        if model is not None
    ]


def usable_memory_gb(backend: str, memory_type: str, vram_mb: int, ram_gb: int) -> tuple[float, str]:
    backend_key = normalize_key(backend)
    memory_key = normalize_key(memory_type)
    if backend_key == "apple" or memory_key == "unified":
        # Unified-memory machines share RAM with the OS, Docker services, and
        # KV cache. Use only a bounded share for the model pick so 32GB-class
        # Macs/APUs are not handed a model that technically fits but thrashes.
        return max(float(ram_gb) * 0.55, 2.0), "unified system memory"
    if backend_key in {"cpu", "none", "unknown"} or vram_mb <= 0:
        return min(max(float(ram_gb) * 0.35, 3.0), 8.0), "system RAM"
    return float(vram_mb) / 1024.0, "GPU VRAM"


def fits(required_gb: float, capacity_gb: float) -> bool:
    return required_gb <= capacity_gb + VRAM_FIT_TOLERANCE_GB


def estimated_param_billions(model: dict[str, Any]) -> float:
    for key in ("total_params_b", "params_b"):
        try:
            value = float(model.get(key) or 0)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
    numbers: list[float] = []
    for text in (model.get("id"), model.get("name"), model.get("llm_model_name"), model.get("gguf_file")):
        numbers.extend(float(match) for match in re.findall(r"(\d+(?:\.\d+)?)\s*b", str(text or ""), re.I))
    if numbers:
        return max(numbers)
    size_mb = float(model.get("size_mb") or 0)
    if size_mb > 0:
        return max(size_mb / 600.0, 1.0)
    return 4.0


def estimated_context_kv_gb(model: dict[str, Any]) -> float:
    context = max(int(model.get("context_length") or 0), 8192)
    params_b = estimated_param_billions(model)
    kv_per_32k_gb = min(max(params_b * 0.12, 0.35), 3.5)
    return round(kv_per_32k_gb * (context / 32768.0), 2)


def selector_required_memory_gb(model: dict[str, Any]) -> float:
    declared = float(model.get("vram_required_gb") or 0)
    size_gb = float(model.get("size_mb") or 0) / 1024.0
    if size_gb <= 0:
        return round(declared, 2)
    return round(max(declared, size_gb + estimated_context_kv_gb(model)), 2)


def family_allowed(model: dict[str, Any], profile: str) -> bool:
    family = normalize_key(model.get("family"))
    if profile == "gemma4":
        return family == "gemma4" or model.get("id") == "qwen3.5-2b-q4"
    return family != "gemma4"


def score_model(model: dict[str, Any], capacity_gb: float, profile: str) -> float:
    required = selector_required_memory_gb(model)
    size_mb = max(float(model.get("size_mb") or 1), 1.0)
    context = max(int(model.get("context_length") or 0), 8192)
    specialty = str(model.get("specialty") or "General")
    family = normalize_key(model.get("family"))
    specialty_weight = {
        "Code": 4.4,
        "Quality": 4.1,
        "General": 3.8,
        "Balanced": 3.5,
        "Reasoning": 3.3,
        "Fast": 2.0,
        "Bootstrap": 1.0,
    }.get(specialty, 2.5)
    family_bonus = 0.35 if profile == "gemma4" and family == "gemma4" else 0.0
    family_bonus += 0.25 if profile in {"qwen", "auto"} and family == "qwen" else 0.0
    context_bonus = min(context / 32768, 4.0) * 0.18
    capability = min(size_mb / 1024, 48.0) * 0.24
    fit_ratio = required / max(capacity_gb, 1.0)
    headroom_penalty = 0.35 if fit_ratio > 0.98 else 0.15 if fit_ratio > 0.92 else 0.0
    return specialty_weight + family_bonus + context_bonus + capability - headroom_penalty


def rank_models(catalog: list[dict[str, Any]], capacity_gb: float, profile: str,
                installable_only: bool) -> list[dict[str, Any]]:
    candidates = []
    for model in catalog:
        if installable_only and not model.get("gguf_url"):
            continue
        if not family_allowed(model, profile):
            continue
        required = selector_required_memory_gb(model)
        if not fits(required, capacity_gb):
            continue
        candidates.append((score_model(model, capacity_gb, profile), model))
    if not candidates:
        fallback_pool = [
            model for model in catalog
            if (not installable_only or model.get("gguf_url")) and family_allowed(model, profile)
        ] or catalog
        fallback = min(fallback_pool, key=lambda m: float(m.get("vram_required_gb") or 999))
        return [fallback]
    candidates.sort(
        key=lambda item: (
            item[0],
            selector_required_memory_gb(item[1]),
            int(item[1].get("context_length") or 0),
        ),
        reverse=True,
    )
    return [model for _, model in candidates]


def shell_value(value: Any) -> str:
    return shlex.quote(str(value or ""))


def recommendation_reason(model: dict[str, Any], capacity_gb: float, memory_label: str,
                          backend: str, confidence: str) -> str:
    context_k = int((model.get("context_length") or 0) / 1024)
    required = selector_required_memory_gb(model)
    return (
        f"Catalog fit ({POLICY}): {model['name']} needs "
        f"about {required:g}GB including context/KV, fits {capacity_gb:.1f}GB "
        f"{memory_label} on {backend}, and gives {context_k}K context. "
        f"Throughput requires a local benchmark after first launch."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--backend", default="unknown")
    parser.add_argument("--memory-type", default="discrete")
    parser.add_argument("--vram-mb", type=int, default=0)
    parser.add_argument("--ram-gb", type=int, default=0)
    parser.add_argument("--profile", default="qwen")
    parser.add_argument("--tier", default="1")
    parser.add_argument("--installable-only", action="store_true")
    parser.add_argument("--env", action="store_true", help="print shell assignments")
    args = parser.parse_args()

    catalog = load_catalog(args.catalog)
    profile = effective_profile(normalize_profile(args.profile), args.backend, args.tier)
    capacity_gb, memory_label = usable_memory_gb(args.backend, args.memory_type, args.vram_mb, args.ram_gb)
    ranked = rank_models(catalog, capacity_gb, profile, args.installable_only)
    selected = ranked[0]
    alternatives = ranked[:3]
    confidence = "high" if args.backend not in {"unknown", "none"} and capacity_gb > 0 else "medium"

    payload = {
        "policy": POLICY,
        "source": "catalog_fit_pre_download",
        "confidence": confidence,
        "profile": profile,
        "memory_capacity_gb": round(capacity_gb, 1),
        "memory_label": memory_label,
        "selected": selected,
        "reason": recommendation_reason(selected, capacity_gb, memory_label, args.backend, confidence),
        "alternatives": [
            {
                "id": model["id"],
                "name": model["name"],
                "gguf": model["gguf_file"],
                "vram_required_gb": model["vram_required_gb"],
                "estimated_required_gb": selector_required_memory_gb(model),
                "context_length": model["context_length"],
                "specialty": model["specialty"],
            }
            for model in alternatives
        ],
    }

    if not args.env:
        print(json.dumps(payload, indent=2))
        return 0

    alt_value = ";".join(
        f"{m['id']}:{int(m['context_length'])}:{selector_required_memory_gb(m):g}"
        for m in alternatives
    )
    env = {
        "LLM_MODEL": selected["llm_model_name"],
        "GGUF_FILE": selected["gguf_file"],
        "GGUF_URL": selected["gguf_url"],
        "GGUF_SHA256": selected["gguf_sha256"],
        "MAX_CONTEXT": selected["context_length"],
        "LLM_MODEL_SIZE_MB": int(round(float(selected["size_mb"]))),
        "MODEL_RECOMMENDATION_SOURCE": payload["source"],
        "MODEL_RECOMMENDATION_POLICY": payload["policy"],
        "MODEL_RECOMMENDATION_CONFIDENCE": payload["confidence"],
        "MODEL_RECOMMENDATION_REASON": payload["reason"],
        "MODEL_RECOMMENDED_ALTERNATIVES": alt_value,
    }
    if selected.get("llama_server_image"):
        env["LLAMA_SERVER_IMAGE"] = selected["llama_server_image"]
    for key, value in env.items():
        print(f"{key}={shell_value(value)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
