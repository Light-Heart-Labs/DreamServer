#!/usr/bin/env python3
"""
M8 Tool Calling Reliability Test

Goal: Measure success rate of OpenAI-format tool calls on local models
Pass criteria: >90% success rate over 100 requests
"""

import requests
import json
import time
import argparse
from typing import Dict, List

LLM_URL = "http://192.168.0.122:8000/v1/chat/completions"
MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ"

# Test tool definition
TEST_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"},
                    "units": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["city"]
            }
        }
    }
]

# Test prompts that should trigger tool calls
TEST_PROMPTS = [
    "What's the weather in Tokyo?",
    "Get me the weather for London in celsius",
    "How's the weather in New York?",
    "Weather in Paris please",
    "Check weather for Berlin",
]


def test_tool_call(prompt: str, request_id: int) -> Dict:
    """Send a request expecting a tool call response"""
    result = {
        "request_id": request_id,
        "prompt": prompt,
        "success": False,
        "has_tool_call": False,
        "tool_name": None,
        "tool_args": None,
        "latency_ms": 0,
        "error": None,
        "raw_response": None
    }
    
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "tools": TEST_TOOLS,
        "tool_choice": "auto",
        "max_tokens": 200
    }
    
    try:
        start = time.perf_counter()
        resp = requests.post(LLM_URL, json=payload, timeout=60)
        result["latency_ms"] = (time.perf_counter() - start) * 1000
        
        if resp.status_code != 200:
            result["error"] = f"HTTP {resp.status_code}: {resp.text[:200]}"
            return result
        
        data = resp.json()
        result["raw_response"] = data
        
        # Check for tool calls in response
        choices = data.get("choices", [])
        if not choices:
            result["error"] = "No choices in response"
            return result
        
        message = choices[0].get("message", {})
        tool_calls = message.get("tool_calls", [])
        
        if tool_calls:
            result["has_tool_call"] = True
            tc = tool_calls[0]
            result["tool_name"] = tc.get("function", {}).get("name")
            
            # Parse arguments
            args_str = tc.get("function", {}).get("arguments", "{}")
            try:
                result["tool_args"] = json.loads(args_str)
                result["success"] = True
            except json.JSONDecodeError:
                result["error"] = f"Invalid JSON in tool args: {args_str[:100]}"
        else:
            # Check if model responded with text instead of tool call
            content = message.get("content", "")
            if content:
                result["error"] = f"Text response instead of tool call: {content[:100]}"
            else:
                result["error"] = "No tool_calls and no content"
        
    except requests.Timeout:
        result["error"] = "Request timeout"
    except Exception as e:
        result["error"] = str(e)
    
    return result


def run_reliability_test(num_requests: int = 100) -> List[Dict]:
    """Run N sequential tool call requests"""
    results = []
    
    for i in range(num_requests):
        prompt = TEST_PROMPTS[i % len(TEST_PROMPTS)]
        print(f"Request {i+1}/{num_requests}: {prompt[:40]}...", end=" ")
        
        result = test_tool_call(prompt, i)
        results.append(result)
        
        if result["success"]:
            print(f"✓ {result['tool_name']}({result['tool_args']}) [{result['latency_ms']:.0f}ms]")
        else:
            print(f"✗ {result['error'][:50]}")
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.1)
    
    return results


def analyze_results(results: List[Dict]):
    """Analyze and report results"""
    total = len(results)
    successful = sum(1 for r in results if r["success"])
    has_tool_call = sum(1 for r in results if r["has_tool_call"])
    
    print(f"\n{'='*60}")
    print(f"TOOL CALLING RELIABILITY TEST RESULTS")
    print(f"{'='*60}")
    
    success_rate = (successful / total) * 100
    tool_call_rate = (has_tool_call / total) * 100
    
    print(f"\nSuccess Rate: {successful}/{total} ({success_rate:.1f}%)")
    print(f"Tool Call Rate: {has_tool_call}/{total} ({tool_call_rate:.1f}%)")
    
    # Latency stats for successful requests
    latencies = [r["latency_ms"] for r in results if r["success"]]
    if latencies:
        print(f"\nLatency (successful requests):")
        print(f"  Avg: {sum(latencies)/len(latencies):.0f}ms")
        print(f"  Min: {min(latencies):.0f}ms")
        print(f"  Max: {max(latencies):.0f}ms")
    
    # Error breakdown
    errors = {}
    for r in results:
        if r["error"]:
            err_type = r["error"].split(":")[0][:30]
            errors[err_type] = errors.get(err_type, 0) + 1
    
    if errors:
        print(f"\nError breakdown:")
        for err, count in sorted(errors.items(), key=lambda x: -x[1]):
            print(f"  {err}: {count}")
    
    # Pass/fail
    threshold = 90
    if success_rate >= threshold:
        print(f"\n✅ PASS: Success rate ({success_rate:.1f}%) >= {threshold}%")
    else:
        print(f"\n❌ FAIL: Success rate ({success_rate:.1f}%) < {threshold}%")
        print(f"\nRecommendation: Try --tool-call-parser hermes in vLLM config")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="M8 Tool Calling Reliability Test")
    parser.add_argument("-n", "--requests", type=int, default=100, help="Number of requests")
    parser.add_argument("--url", default=LLM_URL, help="LLM endpoint URL")
    parser.add_argument("--model", default=MODEL, help="Model name")
    args = parser.parse_args()
    
    LLM_URL = args.url
    MODEL = args.model
    
    print(f"Testing tool calling reliability on {MODEL}")
    print(f"Endpoint: {LLM_URL}")
    print(f"Requests: {args.requests}")
    print()
    
    results = run_reliability_test(args.requests)
    analyze_results(results)
