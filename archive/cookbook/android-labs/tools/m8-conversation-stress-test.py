#!/usr/bin/env python3
"""
M8 Long Conversation Stress Test

Goal: Test context handling over 20+ turn conversations
Pass criteria: No degradation in response quality or latency over conversation length
"""

import requests
import json
import time
import argparse
from typing import Dict, List

LLM_URL = "http://192.168.0.122:8000/v1/chat/completions"
MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ"

# Conversation that builds context
CONVERSATION_TURNS = [
    "Hi! I'm working on a project. Can you help me brainstorm?",
    "It's a voice assistant for local AI. We call it Dream Server.",
    "The main features are: voice chat, local LLM, privacy-first design.",
    "What do you think about adding a workflow builder?",
    "Good point. We already have some JSON workflow templates.",
    "The target users are developers who want to self-host AI.",
    "We're using Qwen 32B for the LLM. Running on vLLM.",
    "Voice is handled by Whisper for STT and Kokoro for TTS.",
    "LiveKit handles the WebRTC layer for real-time voice.",
    "What's a good way to handle multiple concurrent voice sessions?",
    "The current architecture uses Python asyncio throughout.",
    "We have stress tests showing it handles 20-30 concurrent calls.",
    "Memory usage is the main constraint with large context windows.",
    "Do you remember what we said the target users were?",  # Context test
    "And what LLM are we using again?",  # Context test
    "Let's talk about the installer. It's a bash script with tiers.",
    "Tiers are: Nano (Pi), Edge (laptop), Pro (workstation), Cluster.",
    "Each tier has different docker-compose configurations.",
    "What improvements would you suggest for the installer?",
    "Can you summarize everything we discussed?",  # Full context test
]


def chat_turn(messages: List[Dict], user_message: str, turn_num: int) -> Dict:
    """Send a message and get response, measuring latency"""
    result = {
        "turn": turn_num,
        "user_message": user_message,
        "assistant_message": None,
        "latency_ms": 0,
        "token_count": 0,
        "success": False,
        "error": None
    }
    
    messages.append({"role": "user", "content": user_message})
    
    payload = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": 300,
        "temperature": 0.7
    }
    
    try:
        start = time.perf_counter()
        resp = requests.post(LLM_URL, json=payload, timeout=120)
        result["latency_ms"] = (time.perf_counter() - start) * 1000
        
        if resp.status_code != 200:
            result["error"] = f"HTTP {resp.status_code}"
            return result
        
        data = resp.json()
        
        choices = data.get("choices", [])
        if not choices:
            result["error"] = "No choices"
            return result
        
        assistant_msg = choices[0].get("message", {}).get("content", "")
        result["assistant_message"] = assistant_msg
        
        # Get token count if available
        usage = data.get("usage", {})
        result["token_count"] = usage.get("total_tokens", 0)
        
        # Add to conversation history
        messages.append({"role": "assistant", "content": assistant_msg})
        
        result["success"] = True
        
    except requests.Timeout:
        result["error"] = "Timeout"
    except Exception as e:
        result["error"] = str(e)
    
    return result


def run_conversation_test(num_turns: int = 20) -> List[Dict]:
    """Run a multi-turn conversation"""
    messages = [
        {"role": "system", "content": "You are a helpful AI assistant. Keep responses concise but helpful."}
    ]
    results = []
    
    turns_to_use = CONVERSATION_TURNS[:num_turns]
    
    for i, user_msg in enumerate(turns_to_use):
        print(f"\nTurn {i+1}/{len(turns_to_use)}")
        print(f"User: {user_msg[:60]}...")
        
        result = chat_turn(messages, user_msg, i+1)
        results.append(result)
        
        if result["success"]:
            print(f"Assistant: {result['assistant_message'][:80]}...")
            print(f"[{result['latency_ms']:.0f}ms, ~{result['token_count']} tokens]")
        else:
            print(f"ERROR: {result['error']}")
        
        time.sleep(0.5)  # Small delay between turns
    
    return results


def analyze_results(results: List[Dict]):
    """Analyze conversation quality and latency trends"""
    print(f"\n{'='*60}")
    print(f"CONVERSATION STRESS TEST RESULTS")
    print(f"{'='*60}")
    
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    
    print(f"\nCompletion: {len(successful)}/{len(results)} turns successful")
    
    if failed:
        print(f"\nFailed turns:")
        for r in failed:
            print(f"  Turn {r['turn']}: {r['error']}")
    
    if len(successful) < 2:
        print("\nNot enough data for analysis")
        return
    
    # Latency trend analysis
    latencies = [r["latency_ms"] for r in successful]
    first_half = latencies[:len(latencies)//2]
    second_half = latencies[len(latencies)//2:]
    
    first_avg = sum(first_half) / len(first_half)
    second_avg = sum(second_half) / len(second_half)
    
    print(f"\nLatency Analysis:")
    print(f"  First half avg:  {first_avg:.0f}ms")
    print(f"  Second half avg: {second_avg:.0f}ms")
    print(f"  Degradation: {((second_avg - first_avg) / first_avg) * 100:+.1f}%")
    
    # Token growth
    tokens = [r["token_count"] for r in successful if r["token_count"] > 0]
    if tokens:
        print(f"\nToken Usage:")
        print(f"  First turn: {tokens[0]}")
        print(f"  Last turn:  {tokens[-1]}")
        print(f"  Growth: {tokens[-1] - tokens[0]} tokens")
    
    # Context retention check (turns 14-15 ask about earlier content)
    print(f"\nContext Retention:")
    for r in successful:
        if r["turn"] in [14, 15, 20]:
            msg = r["assistant_message"]
            # Check if response references earlier content
            has_context = any(word in msg.lower() for word in 
                           ["developer", "self-host", "qwen", "32b", "voice", "dream"])
            status = "✓ Referenced earlier context" if has_context else "? May have lost context"
            print(f"  Turn {r['turn']}: {status}")
    
    # Pass/fail
    degradation = ((second_avg - first_avg) / first_avg) * 100
    threshold = 50  # Allow up to 50% latency increase
    
    if degradation < threshold and len(failed) == 0:
        print(f"\n✅ PASS: Latency degradation ({degradation:+.1f}%) < {threshold}% and no failures")
    else:
        reasons = []
        if degradation >= threshold:
            reasons.append(f"latency degradation {degradation:+.1f}%")
        if failed:
            reasons.append(f"{len(failed)} failed turns")
        print(f"\n❌ FAIL: {', '.join(reasons)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="M8 Conversation Stress Test")
    parser.add_argument("-n", "--turns", type=int, default=20, help="Number of conversation turns")
    parser.add_argument("--url", default=LLM_URL, help="LLM endpoint URL")
    parser.add_argument("--model", default=MODEL, help="Model name")
    args = parser.parse_args()
    
    LLM_URL = args.url
    MODEL = args.model
    
    print(f"Testing long conversation handling on {MODEL}")
    print(f"Endpoint: {LLM_URL}")
    print(f"Turns: {args.turns}")
    
    results = run_conversation_test(args.turns)
    analyze_results(results)
