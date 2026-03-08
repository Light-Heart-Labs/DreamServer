"""
M4 Classifier Benchmark
Compare DistilBERT vs Qwen latency and accuracy
"""

import time
import sys
sys.path.insert(0, "dream-server/agents/voice/deterministic")

from classifier import QwenClassifier, DistilBERTClassifier, KeywordClassifier

# Test utterances (same as 17's E2E test)
TEST_CASES = [
    ("I need to schedule a heating repair", "schedule_service"),
    ("How much would a new system cost?", "get_quote"),
    ("My AC is broken and it's urgent!", "emergency"),
    ("What are your hours?", "hours_location"),
    ("Thanks, goodbye!", "goodbye"),
    ("Tell me a joke", "fallback"),
]

def benchmark_classifier(classifier, name):
    """Benchmark a classifier."""
    print(f"\n{'='*60}")
    print(f"Benchmarking: {name}")
    print('='*60)
    
    latencies = []
    correct = 0
    
    for text, expected_intent in TEST_CASES:
        start = time.perf_counter()
        result = classifier.predict(text)
        latency = (time.perf_counter() - start) * 1000  # ms
        
        latencies.append(latency)
        is_correct = result.intent == expected_intent
        if is_correct:
            correct += 1
        
        status = "✓" if is_correct else "✗"
        print(f"{status} {latency:6.1f}ms | {result.confidence:.2f} | {result.intent:20s} | {text[:40]}...")
    
    avg_latency = sum(latencies) / len(latencies)
    accuracy = correct / len(TEST_CASES)
    
    print(f"\nResults:")
    print(f"  Average latency: {avg_latency:.1f}ms")
    print(f"  Accuracy: {accuracy*100:.0f}% ({correct}/{len(TEST_CASES)})")
    
    return avg_latency, accuracy

def main():
    print("M4 Intent Classifier Benchmark")
    print("=" * 60)
    
    results = {}
    
    # Benchmark KeywordClassifier (baseline)
    keywords = {
        "schedule_service": ["schedule", "book", "appointment"],
        "get_quote": ["quote", "cost", "price", "much"],
        "emergency": ["urgent", "emergency", "broken"],
        "hours_location": ["hours", "open", "location"],
        "goodbye": ["goodbye", "bye", "thanks"],
    }
    keyword_clf = KeywordClassifier(keywords)
    results['keyword'] = benchmark_classifier(keyword_clf, "KeywordClassifier")
    
    # Benchmark QwenClassifier
    print("\nNote: QwenClassifier requires vLLM running on 192.168.0.122:8000")
    try:
        qwen_clf = QwenClassifier(base_url="http://192.168.0.122:8000/v1")
        results['qwen'] = benchmark_classifier(qwen_clf, "QwenClassifier")
    except Exception as e:
        print(f"\n⚠ QwenClassifier failed: {e}")
        results['qwen'] = (None, None)
    
    # Benchmark DistilBERTClassifier
    print("\nNote: DistilBERTClassifier requires ONNX model in ./models/distilbert-onnx")
    try:
        distil_clf = DistilBERTClassifier(model_path="./models/distilbert-onnx")
        results['distilbert'] = benchmark_classifier(distil_clf, "DistilBERTClassifier")
    except Exception as e:
        print(f"\n⚠ DistilBERTClassifier failed: {e}")
        print("  Run conversion first: python tools/convert-distilbert-onnx.py")
        results['distilbert'] = (None, None)
    
    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print('='*60)
    
    for name, (latency, accuracy) in results.items():
        if latency:
            print(f"{name:15s}: {latency:6.1f}ms | {accuracy*100:5.1f}% accuracy")
        else:
            print(f"{name:15s}: Not available")
    
    # Speedup calculation
    if results['qwen'][0] and results['distilbert'][0]:
        speedup = results['qwen'][0] / results['distilbert'][0]
        print(f"\n🚀 DistilBERT is {speedup:.1f}x faster than Qwen!")

if __name__ == "__main__":
    main()
