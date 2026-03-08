#!/usr/bin/env python3
"""
M4 DistilBERT ONNX Export Pipeline
Converts trained DistilBERT model to ONNX with INT8 quantization.

Prerequisites:
    pip install torch transformers onnx onnxruntime optimum[exporters]

Usage:
    # After Todd's training completes:
    python tools/m4-export-distilbert-onnx.py \
        --model ./models/distilbert-intent \
        --output ./models/distilbert-intent-onnx \
        --quantize

Mission: M4 (Deterministic Voice Agents)
Target: <10ms inference on CPU (vs 250ms Qwen)
"""

import argparse
import sys
from pathlib import Path


def export_to_onnx(model_path: str, output_dir: str, quantize: bool = True):
    """
    Export DistilBERT to ONNX format.
    
    Args:
        model_path: Path to trained HuggingFace model
        output_dir: Output directory for ONNX model
        quantize: Whether to apply INT8 quantization
    """
    print(f"🚀 M4 DistilBERT ONNX Export")
    print(f"   Model: {model_path}")
    print(f"   Output: {output_dir}")
    print(f"   Quantize: {quantize}")
    print()
    
    # Check dependencies
    try:
        from optimum.exporters.onnx import main_export
        print("✅ optimum[exporters] available")
    except ImportError:
        print("❌ optimum not installed")
        print("   Run: pip install optimum[exporters]")
        sys.exit(1)
    
    try:
        import onnxruntime
        print(f"✅ onnxruntime available ({onnxruntime.__version__})")
    except ImportError:
        print("❌ onnxruntime not installed")
        print("   Run: pip install onnxruntime")
        sys.exit(1)
    
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Export to ONNX
    print("\n📦 Step 1: Exporting to ONNX...")
    try:
        main_export(
            model_name_or_path=model_path,
            output=output_path,
            task="text-classification",
            do_validation=True
        )
        print(f"✅ ONNX export complete: {output_path}/model.onnx")
    except Exception as e:
        print(f"❌ Export failed: {e}")
        sys.exit(1)
    
    # Step 2: INT8 Quantization
    if quantize:
        print("\n🔧 Step 2: Applying INT8 quantization...")
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
            
            model_fp32 = output_path / "model.onnx"
            model_int8 = output_path / "model_quantized.onnx"
            
            quantize_dynamic(
                model_input=str(model_fp32),
                model_output=str(model_int8),
                weight_type=QuantType.QInt8,
                optimize_model=True
            )
            
            # Compare sizes
            fp32_size = model_fp32.stat().st_size / (1024 * 1024)
            int8_size = model_int8.stat().st_size / (1024 * 1024)
            
            print(f"✅ Quantization complete:")
            print(f"   FP32: {fp32_size:.1f} MB")
            print(f"   INT8: {int8_size:.1f} MB")
            print(f"   Compression: {fp32_size/int8_size:.1f}×")
            
        except Exception as e:
            print(f"⚠️  Quantization failed: {e}")
            print("   FP32 model is still usable")
    
    # Step 3: Benchmark
    print("\n⚡ Step 3: Benchmarking...")
    benchmark_model(output_path, quantize)
    
    print(f"\n✅ M4 Export Complete!")
    print(f"   Location: {output_path}")
    print(f"\nTo use in M4:")
    print(f"   from classifier import DistilBERTClassifier")
    print(f"   classifier = DistilBERTClassifier(model_path='{output_path}')")


def benchmark_model(model_dir: Path, use_quantized: bool):
    """Benchmark the exported model"""
    try:
        import onnxruntime as ort
        import numpy as np
        import time
        
        model_file = "model_quantized.onnx" if use_quantized else "model.onnx"
        model_path = model_dir / model_file
        
        if not model_path.exists():
            print(f"⚠️  Model not found: {model_path}")
            return
        
        # Create inference session
        session = ort.InferenceSession(str(model_path))
        
        # Get input shape
        input_name = session.get_inputs()[0].name
        input_shape = session.get_inputs()[0].shape
        
        # Dummy input (batch_size=1, seq_length=128)
        seq_length = 128
        dummy_input = np.random.randint(0, 100, (1, seq_length), dtype=np.int64)
        
        # Warmup
        for _ in range(10):
            session.run(None, {input_name: dummy_input})
        
        # Benchmark
        times = []
        for _ in range(100):
            start = time.time()
            session.run(None, {input_name: dummy_input})
            times.append((time.time() - start) * 1000)
        
        avg_time = sum(times) / len(times)
        p95_time = sorted(times)[int(len(times) * 0.95)]
        
        print(f"   Average: {avg_time:.1f}ms")
        print(f"   P95: {p95_time:.1f}ms")
        
        if avg_time < 10:
            print(f"   ✅ Target achieved (<10ms)")
        elif avg_time < 50:
            print(f"   ⚠️  Acceptable (<50ms)")
        else:
            print(f"   ❌ Too slow (>50ms)")
            
    except Exception as e:
        print(f"   ⚠️  Benchmark failed: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Export DistilBERT to ONNX for M4 Intent Classification"
    )
    parser.add_argument(
        "--model",
        required=True,
        help="Path to trained HuggingFace model (from Todd's training)"
    )
    parser.add_argument(
        "--output",
        default="./models/distilbert-intent-onnx",
        help="Output directory for ONNX model"
    )
    parser.add_argument(
        "--no-quantize",
        action="store_true",
        help="Skip INT8 quantization (keep FP32)"
    )
    
    args = parser.parse_args()
    
    export_to_onnx(
        model_path=args.model,
        output_dir=args.output,
        quantize=not args.no_quantize
    )


if __name__ == "__main__":
    main()
