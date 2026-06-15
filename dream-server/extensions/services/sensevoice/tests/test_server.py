"""Unit tests for the SenseVoice STT FastAPI server.

These tests never load the FunASR model: get_model() is monkeypatched and the
heavy import lives behind it, so only fastapi + pytest are required.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

client = TestClient(server.app)


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_strip_special_tokens_removes_sensevoice_markup():
    raw = "<|en|><|NEUTRAL|><|Speech|><|woitn|>hello world"
    assert server.strip_special_tokens(raw) == "hello world"


def test_transcription_maps_model_result_to_text(monkeypatch):
    class FakeModel:
        def generate(self, **kwargs):
            return [{"text": "<|en|><|HAPPY|><|Speech|><|woitn|>the quick brown fox"}]

    monkeypatch.setattr(server, "get_model", lambda: FakeModel())
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("clip.wav", b"RIFFfakeaudio", "audio/wav")},
    )
    assert resp.status_code == 200
    assert resp.json() == {"text": "the quick brown fox"}


def test_transcription_joins_multiple_segments(monkeypatch):
    class FakeModel:
        def generate(self, **kwargs):
            return [
                {"text": "<|en|><|NEUTRAL|><|Speech|><|woitn|>first part"},
                {"text": "<|en|><|NEUTRAL|><|Speech|><|woitn|>second part"},
            ]

    monkeypatch.setattr(server, "get_model", lambda: FakeModel())
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("clip.wav", b"RIFFfakeaudio", "audio/wav")},
    )
    assert resp.status_code == 200
    assert resp.json() == {"text": "first part second part"}


def test_missing_file_returns_400():
    # Send a multipart form without the file field so the endpoint binds
    # file=None (rather than a 422 for an empty body).
    resp = client.post("/v1/audio/transcriptions", data={"language": "auto"})
    assert resp.status_code == 400
