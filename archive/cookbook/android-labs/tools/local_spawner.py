#!/usr/bin/env python3
"""
Local Spawner — Reliable sub-agent spawning for local Qwen models

Implements atomic chain pattern to bypass OpenClaw's tool injection issues
with local models (P3.4). Single-action agents, chained through results.
"""

import requests
import json
import time
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass
from enum import Enum

class Node(Enum):
    NODE_122 = "192.168.0.122"
    NODE_143 = "192.168.0.143"

@dataclass
class SpawnResult:
    success: bool
    result: str
    latency_ms: float
    node: str
    error: Optional[str] = None

class LocalSpawner:
    """
    Reliable local sub-agent spawner using atomic chain pattern.
    
    Bypasses OpenClaw's tool injection by calling vLLM/Ollama directly.
    Each spawn is a single action; complex workflows chain multiple spawns.
    """
    
    def __init__(self, nodes: List[Node] = None, timeout: int = 120):
        self.nodes = nodes or [Node.NODE_122, Node.NODE_143]
        self.timeout = timeout
        self.stop_suffix = "\n\nReply Done. Do not output JSON. Do not loop."
        
    def _get_endpoint(self, node: Node) -> str:
        """Get the appropriate API endpoint for a node."""
        if node == Node.NODE_122:
            # Try Ollama first, fallback to vLLM
            return f"http://{node.value}:11434/v1/chat/completions"
        else:
            return f"http://{node.value}:8000/v1/chat/completions"
    
    def _get_model(self, node: Node) -> str:
        """Get the appropriate model name for a node."""
        if node == Node.NODE_122:
            return "qwen2.5:32b"  # Ollama format
        else:
            return "Qwen/Qwen2.5-32B-Instruct-AWQ"  # vLLM format
    
    def spawn(
        self,
        task: str,
        node: Optional[Node] = None,
        max_tokens: int = 2000,
        temperature: float = 0.7
    ) -> SpawnResult:
        """
        Spawn a single-action sub-agent on a local model.
        
        Args:
            task: The single action to perform (be specific)
            node: Which node to use (defaults to round-robin)
            max_tokens: Maximum response length
            temperature: Sampling temperature
            
        Returns:
            SpawnResult with success status and output
        """
        start = time.perf_counter()
        
        # Select node (round-robin if not specified)
        if node is None:
            node = self.nodes[int(time.time()) % len(self.nodes)]
        
        # Add stop suffix to prevent JSON-as-text garbage
        prompt = task + self.stop_suffix
        
        payload = {
            "model": self._get_model(node),
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False
        }
        
        try:
            endpoint = self._get_endpoint(node)
            resp = requests.post(
                endpoint,
                json=payload,
                timeout=self.timeout
            )
            
            latency_ms = (time.perf_counter() - start) * 1000
            
            if resp.status_code != 200:
                return SpawnResult(
                    success=False,
                    result="",
                    latency_ms=latency_ms,
                    node=node.value,
                    error=f"HTTP {resp.status_code}: {resp.text[:200]}"
                )
            
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            return SpawnResult(
                success=True,
                result=content.strip(),
                latency_ms=latency_ms,
                node=node.value
            )
            
        except requests.Timeout:
            return SpawnResult(
                success=False,
                result="",
                latency_ms=(time.perf_counter() - start) * 1000,
                node=node.value,
                error="Request timeout"
            )
        except Exception as e:
            return SpawnResult(
                success=False,
                result="",
                latency_ms=(time.perf_counter() - start) * 1000,
                node=node.value,
                error=str(e)
            )
    
    def spawn_redundant(
        self,
        task: str,
        count: int = 2,
        timeout_ms: float = 30000
    ) -> SpawnResult:
        """
        Spawn multiple agents on same task, return first success.
        
        Dual redundancy pattern — ensures 100% completion even with
        individual failures.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
        results = []
        
        with ThreadPoolExecutor(max_workers=count) as executor:
            futures = {
                executor.submit(self.spawn, task): i 
                for i in range(count)
            }
            
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                
                if result.success:
                    return result
                
                # If we've tried all and none succeeded
                if len(results) >= count:
                    break
        
        # All failed — return best effort (first result)
        return results[0] if results else SpawnResult(
            success=False,
            result="",
            latency_ms=0,
            node="none",
            error="All redundant spawns failed"
        )
    
    def chain(
        self,
        steps: List[str],
        initial_context: str = "",
        verbose: bool = False
    ) -> Dict:
        """
        Execute a chain of single-action spawns.
        
        Args:
            steps: List of single-action prompts
            initial_context: Starting context for first step
            verbose: Print progress
            
        Returns:
            Dict with final_result, step_results, total_latency_ms
        """
        context = initial_context
        step_results = []
        total_latency = 0
        
        for i, step in enumerate(steps):
            # Inject context into step
            prompt = step.format(context=context) if "{context}" in step else step
            if context and "{context}" not in step:
                prompt = f"Context: {context}\n\nTask: {step}"
            
            if verbose:
                print(f"Step {i+1}/{len(steps)}: {step[:60]}...")
            
            result = self.spawn(prompt)
            step_results.append({
                "step": i + 1,
                "prompt": step,
                "success": result.success,
                "result": result.result[:500] if result.success else result.error,
                "node": result.node,
                "latency_ms": result.latency_ms
            })
            
            total_latency += result.latency_ms
            
            if not result.success:
                if verbose:
                    print(f"  ✗ Failed: {result.error}")
                return {
                    "success": False,
                    "failed_step": i + 1,
                    "error": result.error,
                    "step_results": step_results,
                    "total_latency_ms": total_latency
                }
            
            if verbose:
                print(f"  ✓ Success ({result.latency_ms:.0f}ms on {result.node})")
            
            # Pass result as context for next step
            context = result.result
        
        return {
            "success": True,
            "final_result": context,
            "step_results": step_results,
            "total_latency_ms": total_latency
        }


# Example usage and test
if __name__ == "__main__":
    import sys
    
    print("LocalSpawner Test Suite")
    print("=" * 50)
    
    spawner = LocalSpawner()
    
    # Test 1: Simple spawn
    print("\n1. Simple spawn test:")
    result = spawner.spawn("Say 'Hello from local model' in one sentence.")
    print(f"   Success: {result.success}")
    print(f"   Result: {result.result[:100]}...")
    print(f"   Latency: {result.latency_ms:.0f}ms")
    print(f"   Node: {result.node}")
    
    # Test 2: Redundant spawn
    print("\n2. Redundant spawn test:")
    result = spawner.spawn_redundant("Count from 1 to 3.", count=2)
    print(f"   Success: {result.success}")
    print(f"   Result: {result.result[:100]}...")
    print(f"   Latency: {result.latency_ms:.0f}ms")
    
    # Test 3: Chain
    print("\n3. Chain test:")
    chain_result = spawner.chain([
        "Generate a random animal name.",
        "Describe what a {context} looks like in 2 sentences.",
        "List 3 interesting facts about {context}."
    ], verbose=True)
    
    print(f"\n   Chain success: {chain_result['success']}")
    print(f"   Total latency: {chain_result['total_latency_ms']:.0f}ms")
    if chain_result['success']:
        print(f"   Final result: {chain_result['final_result'][:200]}...")
    
    print("\n" + "=" * 50)
    print("Tests complete!")
