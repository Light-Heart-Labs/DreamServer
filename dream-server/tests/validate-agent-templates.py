#!/usr/bin/env python3
"""
M7 Agent Template Validation
Tests that agent templates work reliably on local qwen2.5-32b-instruct via llama-server.
"""

import requests
import time
import sys

LLAMA_SERVER_URL = "http://localhost:8080"
MODEL = "qwen2.5-32b-instruct"

TEMPLATES = {
    "code-assistant": {
        "system": "You are an expert programming assistant. Write clean, well-documented code.",
        "tests": [
            "Write a Python function to calculate factorial",
            "Debug this: for i in range(len(items)): print(items[i])",
        ]
    },
    "research-assistant": {
        "system": "You are a research assistant. Provide factual, well-sourced information.",
        "tests": [
            "Summarize what Python list comprehensions are",
            "Explain the difference between a stack and a queue",
        ]
    },
    "data-analyst": {
        "system": "You are a data analysis assistant. Help process and understand data.",
        "tests": [
            "How would you find the average of a list of numbers in Python?",
            "Explain what pandas DataFrame.describe() does",
        ]
    },
    "writing-assistant": {
        "system": "You are a writing assistant. Improve clarity and fix errors.",
        "tests": [
            "Fix the grammar: 'Their going to the store'",
            "Make this more concise: 'Due to the fact that it was raining, we decided to stay inside'",
        ]
    },
    "system-admin": {
        "system": "You are a system administration assistant. Help with Docker and Linux.",
        "tests": [
            "What command shows running Docker containers?",
            "How do you check disk usage on Linux?",
        ]
    }
}


def test_template(name: str, config: dict) -> dict:
    """Test a single template"""
    print(f"\n🧪 Testing {name}...")

    results = {
        "template": name,
        "tests": [],
        "passed": 0,
        "failed": 0
    }

    for test_prompt in config["tests"]:
        payload = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": config["system"]},
                {"role": "user", "content": test_prompt}
            ],
            "max_tokens": 200,
            "temperature": 0.7
        }

        try:
            start = time.time()
            response = requests.post(
                f"{LLAMA_SERVER_URL}/v1/chat/completions",
                json=payload,
                timeout=30
            )
            elapsed = (time.time() - start) * 1000

            if response.status_code == 200:
                data = response.json()
                content = data["choices"][0]["message"]["content"]

                # Basic validation - response should be non-empty and relevant
                passed = len(content) > 50 and len(content) < 2000

                results["tests"].append({
                    "prompt": test_prompt[:50],
                    "passed": passed,
                    "time_ms": elapsed,
                    "response_preview": content[:100]
                })

                if passed:
                    results["passed"] += 1
                    print(f"  ✓ {test_prompt[:40]}... ({elapsed:.0f}ms)")
                else:
                    results["failed"] += 1
                    print(f"  ✗ {test_prompt[:40]}... (empty or too long)")
            else:
                results["tests"].append({
                    "prompt": test_prompt[:50],
                    "passed": False,
                    "error": f"HTTP {response.status_code}"
                })
                results["failed"] += 1
                print(f"  ✗ {test_prompt[:40]}... (HTTP {response.status_code})")

        except Exception as e:
            results["tests"].append({
                "prompt": test_prompt[:50],
                "passed": False,
                "error": str(e)
            })
            results["failed"] += 1
            print(f"  ✗ {test_prompt[:40]}... ({e})")

    return results


def main():
    print("=" * 60)
    print("M7 Agent Template Validation")
    print("Testing on qwen2.5-32b-instruct")
    print("=" * 60)

    all_results = []
    total_passed = 0
    total_failed = 0

    for name, config in TEMPLATES.items():
        result = test_template(name, config)
        all_results.append(result)
        total_passed += result["passed"]
        total_failed += result["failed"]

    # Summary
    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)

    for result in all_results:
        status = "✅ PASS" if result["failed"] == 0 else "⚠️ PARTIAL" if result["passed"] > 0 else "❌ FAIL"
        print(f"{result['template']:20} {status} ({result['passed']}/{result['passed']+result['failed']} tests)")

    print("-" * 60)
    print(f"Total: {total_passed} passed, {total_failed} failed")

    if total_failed == 0:
        print("\n✅ All templates validated successfully!")
        return 0
    else:
        print(f"\n⚠️ {total_failed} tests failed - review needed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
