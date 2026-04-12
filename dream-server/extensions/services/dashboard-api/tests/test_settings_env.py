"""Security-focused tests for the Settings environment editor."""

import json

import pytest


@pytest.fixture()
def settings_env_fixture(tmp_path, monkeypatch):
    install_root = tmp_path / "dream-server"
    install_root.mkdir()
    data_root = tmp_path / "data"
    data_root.mkdir()

    env_path = install_root / ".env"
    example_path = install_root / ".env.example"
    schema_path = install_root / ".env.schema.json"

    env_path.write_text(
        "OPENAI_API_KEY=sk-live-secret\n"
        "LLM_BACKEND=local\n"
        "WEBUI_AUTH=true\n",
        encoding="utf-8",
    )

    example_path.write_text(
        "# ════════════════════════════════\n"
        "# LLM Settings\n"
        "# ════════════════════════════════\n"
        "OPENAI_API_KEY=\n"
        "LLM_BACKEND=local\n"
        "WEBUI_AUTH=true\n",
        encoding="utf-8",
    )

    schema_path.write_text(
        json.dumps(
            {
                "type": "object",
                "properties": {
                    "OPENAI_API_KEY": {
                        "type": "string",
                        "description": "Key used for cloud LLM providers.",
                        "secret": True,
                    },
                    "LLM_BACKEND": {
                        "type": "string",
                        "description": "Primary LLM backend mode.",
                        "enum": ["local", "cloud"],
                        "default": "local",
                    },
                    "WEBUI_AUTH": {
                        "type": "boolean",
                        "description": "Require login for the WebUI.",
                        "default": True,
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr("main._resolve_install_root", lambda: install_root)
    monkeypatch.setattr("main._resolve_runtime_env_path", lambda: env_path)
    monkeypatch.setattr("main.DATA_DIR", str(data_root))

    def fake_env_update(raw_text):
        backup_dir = data_root / "config-backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / ".env.backup.test"
        if env_path.exists():
            backup_path.write_bytes(env_path.read_bytes())
        payload = raw_text if raw_text.endswith("\n") else raw_text + "\n"
        env_path.write_text(payload, encoding="utf-8")
        return {"backup_path": "data/config-backups/.env.backup.test"}

    monkeypatch.setattr("main._call_agent_env_update", fake_env_update)

    def fake_resolve_template(name: str):
        if name == ".env.example":
            return example_path
        if name == ".env.schema.json":
            return schema_path
        return install_root / name

    monkeypatch.setattr("main._resolve_template_path", fake_resolve_template)

    from main import _cache

    _cache._store.clear()

    return {
        "install_root": install_root,
        "data_root": data_root,
        "env_path": env_path,
    }


def test_api_settings_env_masks_secret_values(test_client, settings_env_fixture):
    response = test_client.get("/api/settings/env", headers=test_client.auth_headers)

    assert response.status_code == 200
    payload = response.json()

    assert payload["path"] == ".env"
    assert payload["raw"] == ""
    assert payload["values"]["OPENAI_API_KEY"] == ""
    assert payload["fields"]["OPENAI_API_KEY"]["value"] == ""
    assert payload["fields"]["OPENAI_API_KEY"]["hasValue"] is True
    assert payload["fields"]["OPENAI_API_KEY"]["secret"] is True
    assert payload["values"]["LLM_BACKEND"] == "local"
    assert payload["fields"]["LLM_BACKEND"]["value"] == "local"


def test_api_settings_env_preserves_existing_secret_when_blank(test_client, settings_env_fixture):
    env_path = settings_env_fixture["env_path"]

    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={
            "mode": "form",
            "values": {
                "OPENAI_API_KEY": "",
                "LLM_BACKEND": "cloud",
                "WEBUI_AUTH": "false",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    updated_env = env_path.read_text(encoding="utf-8")

    assert "OPENAI_API_KEY=sk-live-secret" in updated_env
    assert "LLM_BACKEND=cloud" in updated_env
    assert "WEBUI_AUTH=false" in updated_env
    assert payload["values"]["OPENAI_API_KEY"] == ""
    assert payload["fields"]["OPENAI_API_KEY"]["hasValue"] is True
    assert payload["backupPath"].startswith("data/config-backups/.env.backup.")
    assert payload["applyPlan"]["status"] == "ready"
    assert payload["applyPlan"]["services"] == ["llama-server", "open-webui"]


def test_api_settings_env_rejects_raw_mode(test_client, settings_env_fixture):
    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={"mode": "raw", "raw": "OPENAI_API_KEY=oops\n"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["message"] == "Only form-based editing is supported for security reasons."


def test_api_settings_env_rejects_new_unknown_keys(test_client, settings_env_fixture):
    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={
            "mode": "form",
            "values": {
                "OPENAI_API_KEY": "",
                "INJECTED_FLAG": "true",
            },
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["message"] == "Configuration validation failed."
    assert payload["detail"]["issues"] == [
        {
            "key": "INJECTED_FLAG",
            "message": "Field is not editable from the dashboard. Only schema-backed fields and existing local overrides can be changed here.",
        }
    ]


def test_api_settings_env_allows_existing_local_override(test_client, settings_env_fixture):
    env_path = settings_env_fixture["env_path"]
    env_path.write_text(
        env_path.read_text(encoding="utf-8") + "LOCAL_OVERRIDE=keep-me\n",
        encoding="utf-8",
    )

    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={
            "mode": "form",
            "values": {
                "LOCAL_OVERRIDE": "updated",
            },
        },
    )

    assert response.status_code == 200
    updated_env = env_path.read_text(encoding="utf-8")
    assert "LOCAL_OVERRIDE=updated" in updated_env


def test_api_settings_env_rejects_newline_in_value(test_client, settings_env_fixture):
    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={
            "mode": "form",
            "values": {
                "LLM_BACKEND": "local\nINJECTED_KEY=malicious",
            },
        },
    )

    assert response.status_code == 400
    assert "invalid characters" in response.json()["detail"]


def test_api_settings_env_rejects_null_byte_in_value(test_client, settings_env_fixture):
    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={
            "mode": "form",
            "values": {
                "LLM_BACKEND": "local\x00injected",
            },
        },
    )

    assert response.status_code == 400
    assert "invalid characters" in response.json()["detail"]


def test_api_settings_env_save_returns_llama_apply_plan(test_client, settings_env_fixture):
    env_path = settings_env_fixture["env_path"]
    env_path.write_text(
        env_path.read_text(encoding="utf-8") + "CTX_SIZE=8192\n",
        encoding="utf-8",
    )

    response = test_client.put(
        "/api/settings/env",
        headers=test_client.auth_headers,
        json={
            "mode": "form",
            "values": {
                "CTX_SIZE": "16384",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["applyPlan"]["status"] == "ready"
    assert payload["applyPlan"]["services"] == ["llama-server"]
    assert "llama-server" in payload["applyPlan"]["summary"]


def test_api_settings_env_apply_calls_host_agent(test_client, monkeypatch):
    captured = {}

    def fake_call(service_ids):
        captured["service_ids"] = service_ids
        return {"status": "ok"}

    monkeypatch.setattr("main._call_agent_core_recreate", fake_call)

    response = test_client.post(
        "/api/settings/env/apply",
        headers=test_client.auth_headers,
        json={"service_ids": ["llama-server"]},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert captured["service_ids"] == ["llama-server"]


def test_api_settings_env_apply_rejects_disallowed_service(test_client):
    response = test_client.post(
        "/api/settings/env/apply",
        headers=test_client.auth_headers,
        json={"service_ids": ["dashboard-api"]},
    )

    assert response.status_code == 400
    assert "not eligible" in response.json()["detail"]["message"].lower()


# --- Render round-trip fidelity ---


def test_render_env_preserves_extras_with_empty_values():
    """Keys with empty values must survive _render_env_from_values round-trip.

    Regression guard for fork issue #335: the old filter
    ``value != ""`` silently dropped keys like LLAMA_ARG_TENSOR_SPLIT=""
    on every save.
    """
    from main import _render_env_from_values

    values = {
        "LLM_BACKEND": "local",
        "TENSOR_SPLIT": "",       # intentionally empty
        "GPU_UUID": "GPU-abc123",
    }
    rendered = _render_env_from_values(values)
    assert "TENSOR_SPLIT=" in rendered
    assert "GPU_UUID=GPU-abc123" in rendered
