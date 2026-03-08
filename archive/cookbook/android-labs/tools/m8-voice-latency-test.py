#!/usr/bin/env python3
"""
M8 Voice Latency Test — Concurrent STT→LLM→TTS round trips

Goal: Measure full voice pipeline latency under load
Pass criteria: P95 < 3000ms for 10 concurrent sessions
"""

import asyncio
import aiohttp
import time
import statistics
import argparse
from typing import List, Dict

# Default endpoints (Dream Server on .122)
# naming matches the SDK's base_url parameter for clarity
STT_BASE_URL = "http://192.168.0.122:9000/v1/audio/transcriptions"
LLM_BASE_URL = "http://192.168.0.122:8000/v1/chat/completions"
TTS_BASE_URL = "http://192.168.0.122:8880/v1/audio/speech"

# Test audio: 1 second of silence (base64 WAV)
TEST_AUDIO_PATH = "test_audio.wav"


async def measure_stt(session: aiohttp.ClientSession, audio_path: str) -> tuple[float, str]:
    """Send audio to STT, return (latency_ms, transcription)"""
    start = time.perf_counter()
    
    with open(audio_path, 'rb') as f:
        data = aiohttp.FormData()
        data.add_field('file', f, filename='audio.wav', content_type='audio/wav')
        data.add_field('model', 'whisper-1')
        
        async with session.post(STT_URL, data=data) as resp:
            result = await resp.json()
            latency = (time.perf_counter() - start) * 1000
            return latency, result.get('text', '')


async def measure_llm(session: aiohttp.ClientSession, prompt: str) -> tuple[float, str]:
    """Send prompt to LLM, return (latency_ms, response)"""
    start = time.perf_counter()
    
    payload = {
        "model": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 100
    }
    
    async with session.post(LLM_URL, json=payload) as resp:
        result = await resp.json()
        latency = (time.perf_counter() - start) * 1000
        text = result.get('choices', [{}])[0].get('message', {}).get('content', '')
        return latency, text


async def measure_tts(session: aiohttp.ClientSession, text: str) -> float:
    """Send text to TTS, return latency_ms"""
    start = time.perf_counter()
    
    payload = {
        "model": "kokoro",
        "input": text,
        "voice": "af_bella"
    }
    
    async with session.post(TTS_BASE_URL, json=payload) as resp:
        await resp.read()  # Consume response
        latency = (time.perf_counter() - start) * 1000
        return latency


async def run_voice_session(session_id: int) -> Dict:
    """Run complete STT→LLM→TTS pipeline, return timing dict"""
    result = {
        "session_id": session_id,
        "stt_ms": 0,
        "llm_ms": 0,
        "tts_ms": 0,
        "total_ms": 0,
        "success": False,
        "error": None
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            # For testing without real audio, use a simple prompt
            # In production, would use actual audio file
            prompt = f"Say hello, this is session {session_id}"
            
            # Skip STT for now (needs real audio), measure LLM + TTS
            start = time.perf_counter()
            
            llm_latency, llm_response = await measure_llm(session, prompt)
            result["llm_ms"] = llm_latency
            
            if llm_response:
                tts_latency = await measure_tts(session, llm_response[:200])
                result["tts_ms"] = tts_latency
            
            result["total_ms"] = (time.perf_counter() - start) * 1000
            result["success"] = True
            
    except Exception as e:
        result["error"] = str(e)
    
    return result


async def run_concurrent_test(num_sessions: int = 10) -> List[Dict]:
    """Run N concurrent voice sessions"""
    print(f"Starting {num_sessions} concurrent voice sessions...")
    
    tasks = [run_voice_session(i) for i in range(num_sessions)]
    results = await asyncio.gather(*tasks)
    
    return results


def analyze_results(results: List[Dict]):
    """Analyze and print results"""
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    
    print(f"\n{'='*50}")
    print(f"RESULTS: {len(successful)}/{len(results)} successful")
    print(f"{'='*50}")
    
    if failed:
        print(f"\nFailed sessions:")
        for r in failed:
            print(f"  Session {r['session_id']}: {r['error']}")
    
    if successful:
        llm_times = [r["llm_ms"] for r in successful]
        tts_times = [r["tts_ms"] for r in successful if r["tts_ms"] > 0]
        total_times = [r["total_ms"] for r in successful]
        
        print(f"\nLLM Latency:")
        print(f"  Avg: {statistics.mean(llm_times):.0f}ms")
        print(f"  P50: {statistics.median(llm_times):.0f}ms")
        print(f"  P95: {sorted(llm_times)[int(len(llm_times)*0.95)]:.0f}ms")
        
        if tts_times:
            print(f"\nTTS Latency:")
            print(f"  Avg: {statistics.mean(tts_times):.0f}ms")
            print(f"  P50: {statistics.median(tts_times):.0f}ms")
            print(f"  P95: {sorted(tts_times)[int(len(tts_times)*0.95)]:.0f}ms")
        
        print(f"\nTotal Round-Trip (LLM+TTS):")
        print(f"  Avg: {statistics.mean(total_times):.0f}ms")
        print(f"  P50: {statistics.median(total_times):.0f}ms")
        print(f"  P95: {sorted(total_times)[int(len(total_times)*0.95)]:.0f}ms")
        
        # Pass/fail
        p95 = sorted(total_times)[int(len(total_times)*0.95)]
        threshold = 3000
        if p95 < threshold:
            print(f"\n✅ PASS: P95 ({p95:.0f}ms) < {threshold}ms threshold")
        else:
            print(f"\n❌ FAIL: P95 ({p95:.0f}ms) >= {threshold}ms threshold")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="M8 Voice Latency Test")
    parser.add_argument("-n", "--sessions", type=int, default=10, help="Number of concurrent sessions")
    parser.add_argument("--stt-url", default=STT_BASE_URL, help="STT endpoint URL")
    parser.add_argument("--llm-url", default=LLM_BASE_URL, help="LLM endpoint URL")
    parser.add_argument("--tts-url", default=TTS_BASE_URL, help="TTS endpoint URL")
    args = parser.parse_args()
    
    STT_BASE_URL = args.stt_url
    LLM_BASE_URL = args.llm_url
    TTS_BASE_URL = args.tts_url
    
    results = asyncio.run(run_concurrent_test(args.sessions))
    analyze_results(results)
