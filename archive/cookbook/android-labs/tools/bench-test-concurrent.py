#!/usr/bin/env python3
"""
Concurrent Bench Testing Framework for Mission 8
Tests local LLM performance under concurrent load

Usage:
    python bench-test-concurrent.py --users 10 --duration 60
    python bench-test-concurrent.py --users 1,5,10,20 --ramp-up

Outputs:
    - JSON results with latency percentiles
    - Token throughput metrics
    - GPU memory tracking
"""

import asyncio
import argparse
import json
import time
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import List, Dict, Optional
import requests
import psutil

# Endpoints
ENDPOINTS = {
    "coder": "http://192.168.0.122:8003/v1/chat/completions",
    "sage": "http://192.168.0.143:8003/v1/chat/completions"
}

DEFAULT_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ"

# Test prompts of varying complexity
TEST_PROMPTS = [
    {"name": "simple", "prompt": "What is 2+2?", "expected_tokens": 50},
    {"name": "medium", "prompt": "Explain the concept of recursion in programming with an example.", "expected_tokens": 200},
    {"name": "complex", "prompt": "Design a Python class for a thread-safe priority queue with O(log n) operations. Include methods for put, get, peek, and size.", "expected_tokens": 500},
]


@dataclass
class RequestResult:
    """Result of a single request"""
    user_id: int
    prompt_name: str
    start_time: float
    end_time: float
    latency_ms: float
    tokens_generated: int
    tokens_per_second: float
    success: bool
    error: Optional[str] = None
    endpoint: str = ""


@dataclass
class BenchmarkRun:
    """Results of a complete benchmark run"""
    concurrent_users: int
    start_time: float
    end_time: float
    results: List[RequestResult] = field(default_factory=list)
    
    @property
    def total_requests(self) -> int:
        return len(self.results)
    
    @property
    def successful_requests(self) -> int:
        return sum(1 for r in self.results if r.success)
    
    @property
    def failed_requests(self) -> int:
        return sum(1 for r in self.results if not r.success)
    
    @property
    def success_rate(self) -> float:
        if not self.results:
            return 0.0
        return self.successful_requests / len(self.results) * 100
    
    @property
    def latencies_ms(self) -> List[float]:
        return [r.latency_ms for r in self.results if r.success]
    
    @property
    def p50_latency_ms(self) -> float:
        return statistics.median(self.latencies_ms) if self.latencies_ms else 0
    
    @property
    def p95_latency_ms(self) -> float:
        if not self.latencies_ms:
            return 0
        sorted_lat = sorted(self.latencies_ms)
        idx = int(len(sorted_lat) * 0.95)
        return sorted_lat[min(idx, len(sorted_lat)-1)]
    
    @property
    def p99_latency_ms(self) -> float:
        if not self.latencies_ms:
            return 0
        sorted_lat = sorted(self.latencies_ms)
        idx = int(len(sorted_lat) * 0.99)
        return sorted_lat[min(idx, len(sorted_lat)-1)]
    
    @property
    def mean_throughput_tps(self) -> float:
        successful = [r.tokens_per_second for r in self.results if r.success]
        return statistics.mean(successful) if successful else 0
    
    @property
    def total_tokens_generated(self) -> int:
        return sum(r.tokens_generated for r in self.results if r.success)
    
    def to_dict(self) -> Dict:
        return {
            "concurrent_users": self.concurrent_users,
            "duration_sec": self.end_time - self.start_time,
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "success_rate_pct": round(self.success_rate, 2),
            "latency_ms": {
                "p50": round(self.p50_latency_ms, 2),
                "p95": round(self.p95_latency_ms, 2),
                "p99": round(self.p99_latency_ms, 2),
                "mean": round(statistics.mean(self.latencies_ms), 2) if self.latencies_ms else 0,
                "min": round(min(self.latencies_ms), 2) if self.latencies_ms else 0,
                "max": round(max(self.latencies_ms), 2) if self.latencies_ms else 0,
            },
            "throughput": {
                "mean_tokens_per_sec": round(self.mean_throughput_tps, 2),
                "total_tokens_generated": self.total_tokens_generated,
            }
        }


def send_request(endpoint: str, prompt: str, user_id: int, prompt_name: str) -> RequestResult:
    """Send a single request to the LLM endpoint"""
    start_time = time.time()
    
    try:
        response = requests.post(
            endpoint,
            json={
                "model": DEFAULT_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 512,
                "temperature": 0.7,
            },
            timeout=120,
            headers={"Content-Type": "application/json"}
        )
        
        end_time = time.time()
        latency_ms = (end_time - start_time) * 1000
        
        if response.status_code == 200:
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            # Estimate tokens (rough approximation)
            tokens_generated = len(content.split()) * 1.3
            
            return RequestResult(
                user_id=user_id,
                prompt_name=prompt_name,
                start_time=start_time,
                end_time=end_time,
                latency_ms=latency_ms,
                tokens_generated=int(tokens_generated),
                tokens_per_second=tokens_generated / (latency_ms / 1000) if latency_ms > 0 else 0,
                success=True,
                endpoint=endpoint
            )
        else:
            return RequestResult(
                user_id=user_id,
                prompt_name=prompt_name,
                start_time=start_time,
                end_time=end_time,
                latency_ms=latency_ms,
                tokens_generated=0,
                tokens_per_second=0,
                success=False,
                error=f"HTTP {response.status_code}: {response.text}",
                endpoint=endpoint
            )
            
    except Exception as e:
        end_time = time.time()
        return RequestResult(
            user_id=user_id,
            prompt_name=prompt_name,
            start_time=start_time,
            end_time=end_time,
            latency_ms=(end_time - start_time) * 1000,
            tokens_generated=0,
            tokens_per_second=0,
            success=False,
            error=str(e),
            endpoint=endpoint
        )


def run_concurrent_test(concurrent_users: int, requests_per_user: int = 5, endpoint: str = None) -> BenchmarkRun:
    """Run a benchmark with specified concurrent users"""
    
    if endpoint is None:
        endpoint = ENDPOINTS["coder"]
    
    print(f"\n🚀 Starting benchmark: {concurrent_users} concurrent users, {requests_per_user} requests each")
    print(f"   Endpoint: {endpoint}")
    
    benchmark = BenchmarkRun(
        concurrent_users=concurrent_users,
        start_time=time.time(),
        results=[]
    )
    
    # Create work items
    work_items = []
    for user_id in range(concurrent_users):
        for req_num in range(requests_per_user):
            prompt = TEST_PROMPTS[req_num % len(TEST_PROMPTS)]
            work_items.append((user_id, prompt))
    
    # Execute with thread pool
    with ThreadPoolExecutor(max_workers=concurrent_users) as executor:
        futures = {
            executor.submit(send_request, endpoint, prompt["prompt"], user_id, prompt["name"]): (user_id, prompt)
            for user_id, prompt in work_items
        }
        
        completed = 0
        for future in as_completed(futures):
            result = future.result()
            benchmark.results.append(result)
            completed += 1
            
            if result.success:
                print(f"  ✓ [{completed}/{len(work_items)}] User {result.user_id}: {result.prompt_name} - {result.latency_ms:.0f}ms")
            else:
                print(f"  ✗ [{completed}/{len(work_items)}] User {result.user_id}: FAILED - {result.error[:50]}")
    
    benchmark.end_time = time.time()
    return benchmark


def print_results(benchmark: BenchmarkRun):
    """Print benchmark results"""
    print(f"\n{'='*60}")
    print(f"📊 BENCHMARK RESULTS: {benchmark.concurrent_users} Concurrent Users")
    print(f"{'='*60}")
    print(f"Duration: {benchmark.end_time - benchmark.start_time:.1f}s")
    print(f"Total Requests: {benchmark.total_requests}")
    print(f"Success Rate: {benchmark.success_rate:.1f}%")
    print(f"\n⏱️  Latency (ms):")
    print(f"   p50: {benchmark.p50_latency_ms:.0f}")
    print(f"   p95: {benchmark.p95_latency_ms:.0f}")
    print(f"   p99: {benchmark.p99_latency_ms:.0f}")
    print(f"   min: {min(benchmark.latencies_ms):.0f}" if benchmark.latencies_ms else "   min: N/A")
    print(f"   max: {max(benchmark.latencies_ms):.0f}" if benchmark.latencies_ms else "   max: N/A")
    print(f"\n📝 Throughput:")
    print(f"   Mean tokens/sec: {benchmark.mean_throughput_tps:.1f}")
    print(f"   Total tokens: {benchmark.total_tokens_generated}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Benchmark local LLM performance under concurrent load")
    parser.add_argument("--users", type=str, default="1,5,10,20", 
                        help="Comma-separated list of concurrent user counts to test")
    parser.add_argument("--requests", type=int, default=5,
                        help="Number of requests per user")
    parser.add_argument("--endpoint", type=str, choices=["coder", "sage"], default="coder",
                        help="Which endpoint to test")
    parser.add_argument("--output", type=str, default="benchmark-results.json",
                        help="Output JSON file for results")
    parser.add_argument("--ramp-up", action="store_true",
                        help="Run tests sequentially with increasing load")
    
    args = parser.parse_args()
    
    # Parse user counts
    user_counts = [int(u.strip()) for u in args.users.split(",")]
    endpoint = ENDPOINTS[args.endpoint]
    
    print("="*60)
    print("🧪 MISSION 8: CONCURRENT BENCHMARK FRAMEWORK")
    print("="*60)
    print(f"Testing endpoint: {endpoint}")
    print(f"User counts: {user_counts}")
    print(f"Requests per user: {args.requests}")
    
    all_results = []
    
    for user_count in user_counts:
        benchmark = run_concurrent_test(user_count, args.requests, endpoint)
        print_results(benchmark)
        all_results.append(benchmark.to_dict())
    
    # Save results
    with open(args.output, "w") as f:
        json.dump(all_results, f, indent=2)
    
    print(f"✅ Results saved to {args.output}")
    
    # Summary
    print("\n📈 SUMMARY:")
    print(f"{'Users':<10} {'Success %':<12} {'p50 Latency':<15} {'p95 Latency':<15} {'Tokens/sec':<12}")
    print("-" * 70)
    for result in all_results:
        print(f"{result['concurrent_users']:<10} {result['success_rate_pct']:<12.1f} "
              f"{result['latency_ms']['p50']:<15.0f} {result['latency_ms']['p95']:<15.0f} "
              f"{result['throughput']['mean_tokens_per_sec']:<12.1f}")


if __name__ == "__main__":
    main()
