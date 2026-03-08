#!/usr/bin/env python3
"""
LiveKit Stress Test Results Analyzer
Parses and visualizes results from livekit-concurrent-test.py

Features:
- Summary statistics across all test runs
- Latency distribution analysis
- Scalability assessment (latency vs concurrent sessions)
- Export to various formats (text, CSV, markdown)

Usage:
    python livekit-analyze-results.py results.json
    python livekit-analyze-results.py results.json --format markdown --output report.md
    python livekit-analyze-results.py results.json --csv latencies.csv
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional
import statistics


def load_results(filepath: str) -> dict:
    """Load test results from JSON file"""
    with open(filepath, 'r') as f:
        return json.load(f)


def extract_all_latencies(results: dict) -> dict:
    """Extract all latency measurements organized by session count"""
    latencies_by_count = {}
    
    for run in results.get('test_runs', []):
        count = run['concurrent_sessions']
        if count not in latencies_by_count:
            latencies_by_count[count] = {
                'connect': [],
                'first_byte': [],
                'total': [],
                'errors': 0,
            }
        
        for session in run.get('sessions', []):
            if session.get('connected'):
                connect_latency = (session['connect_end'] - session['connect_start']) * 1000
                latencies_by_count[count]['connect'].append(connect_latency)
            
            latencies_by_count[count]['errors'] += len(session.get('errors', []))
            
            for m in session.get('measurements', []):
                if m.get('first_response_time') and m.get('audio_send_time'):
                    fb = (m['first_response_time'] - m['audio_send_time']) * 1000
                    latencies_by_count[count]['first_byte'].append(fb)
                if m.get('response_complete_time') and m.get('audio_send_time'):
                    total = (m['response_complete_time'] - m['audio_send_time']) * 1000
                    latencies_by_count[count]['total'].append(total)
    
    return latencies_by_count


def calc_stats(values: list) -> dict:
    """Calculate statistics for a list of values"""
    if not values:
        return {'count': 0, 'min': None, 'max': None, 'mean': None, 
                'median': None, 'stdev': None, 'p50': None, 'p90': None, 'p95': None, 'p99': None}
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    
    return {
        'count': n,
        'min': round(min(values), 2),
        'max': round(max(values), 2),
        'mean': round(statistics.mean(values), 2),
        'median': round(statistics.median(values), 2),
        'stdev': round(statistics.stdev(values), 2) if n > 1 else 0,
        'p50': round(sorted_vals[int(n * 0.50)], 2),
        'p90': round(sorted_vals[int(n * 0.90)], 2) if n >= 10 else round(sorted_vals[-1], 2),
        'p95': round(sorted_vals[int(n * 0.95)], 2) if n >= 20 else round(sorted_vals[-1], 2),
        'p99': round(sorted_vals[int(n * 0.99)], 2) if n >= 100 else round(sorted_vals[-1], 2),
    }


def format_text_report(results: dict, latencies: dict) -> str:
    """Generate plain text report"""
    lines = []
    config = results.get('test_config', {})
    
    lines.append("=" * 70)
    lines.append("LIVEKIT VOICE STRESS TEST RESULTS")
    lines.append("=" * 70)
    lines.append("")
    lines.append("TEST CONFIGURATION")
    lines.append("-" * 40)
    lines.append(f"  LiveKit URL:         {config.get('livekit_url', 'N/A')}")
    lines.append(f"  Session counts:      {config.get('session_counts', [])}")
    lines.append(f"  Duration per run:    {config.get('duration_seconds', 0)}s")
    lines.append(f"  Measurement interval: {config.get('measurement_interval', 0)}s")
    lines.append("")
    
    # Summary table
    lines.append("RESULTS BY CONCURRENT SESSION COUNT")
    lines.append("-" * 70)
    lines.append(f"{'Sessions':>8} | {'Connect(ms)':>12} | {'FirstByte(ms)':>14} | {'Total(ms)':>12} | {'Errors':>6}")
    lines.append("-" * 70)
    
    for count in sorted(latencies.keys()):
        data = latencies[count]
        connect_stats = calc_stats(data['connect'])
        fb_stats = calc_stats(data['first_byte'])
        total_stats = calc_stats(data['total'])
        
        connect_str = f"{connect_stats['mean']:.0f}" if connect_stats['mean'] else "N/A"
        fb_str = f"{fb_stats['mean']:.0f}" if fb_stats['mean'] else "N/A"
        total_str = f"{total_stats['mean']:.0f}" if total_stats['mean'] else "N/A"
        
        lines.append(f"{count:>8} | {connect_str:>12} | {fb_str:>14} | {total_str:>12} | {data['errors']:>6}")
    
    lines.append("-" * 70)
    lines.append("")
    
    # Detailed stats per session count
    for count in sorted(latencies.keys()):
        data = latencies[count]
        lines.append(f"DETAILED STATS: {count} CONCURRENT SESSIONS")
        lines.append("-" * 50)
        
        for metric_name, values in [('Connect Latency', data['connect']),
                                     ('First Byte Latency', data['first_byte']),
                                     ('Total Round Trip', data['total'])]:
            stats = calc_stats(values)
            if stats['count'] > 0:
                lines.append(f"  {metric_name}:")
                lines.append(f"    Count:  {stats['count']}")
                lines.append(f"    Min:    {stats['min']:.2f}ms")
                lines.append(f"    Max:    {stats['max']:.2f}ms")
                lines.append(f"    Mean:   {stats['mean']:.2f}ms")
                lines.append(f"    Median: {stats['median']:.2f}ms")
                lines.append(f"    Stdev:  {stats['stdev']:.2f}ms")
                lines.append(f"    P90:    {stats['p90']:.2f}ms")
                lines.append(f"    P95:    {stats['p95']:.2f}ms")
                lines.append(f"    P99:    {stats['p99']:.2f}ms")
                lines.append("")
        
        lines.append("")
    
    # Scalability assessment
    lines.append("SCALABILITY ASSESSMENT")
    lines.append("-" * 50)
    
    counts = sorted(latencies.keys())
    if len(counts) >= 2:
        baseline_count = counts[0]
        baseline_fb = calc_stats(latencies[baseline_count]['first_byte'])
        
        if baseline_fb['mean']:
            for count in counts[1:]:
                current_fb = calc_stats(latencies[count]['first_byte'])
                if current_fb['mean']:
                    increase = ((current_fb['mean'] - baseline_fb['mean']) / baseline_fb['mean']) * 100
                    lines.append(f"  {baseline_count} → {count} sessions: "
                               f"First byte latency {'increased' if increase > 0 else 'decreased'} "
                               f"{abs(increase):.1f}%")
    
    lines.append("")
    lines.append("=" * 70)
    lines.append(f"Report generated: {datetime.utcnow().isoformat()}Z")
    lines.append("=" * 70)
    
    return "\n".join(lines)


def format_markdown_report(results: dict, latencies: dict) -> str:
    """Generate Markdown report"""
    lines = []
    config = results.get('test_config', {})
    
    lines.append("# LiveKit Voice Stress Test Results")
    lines.append("")
    lines.append("## Test Configuration")
    lines.append("")
    lines.append(f"- **LiveKit URL:** `{config.get('livekit_url', 'N/A')}`")
    lines.append(f"- **Session counts tested:** {config.get('session_counts', [])}")
    lines.append(f"- **Duration per run:** {config.get('duration_seconds', 0)} seconds")
    lines.append(f"- **Measurement interval:** {config.get('measurement_interval', 0)} seconds")
    lines.append("")
    
    # Summary table
    lines.append("## Summary by Session Count")
    lines.append("")
    lines.append("| Sessions | Connect (ms) | First Byte (ms) | Total RT (ms) | Errors |")
    lines.append("|----------|--------------|-----------------|---------------|--------|")
    
    for count in sorted(latencies.keys()):
        data = latencies[count]
        connect_stats = calc_stats(data['connect'])
        fb_stats = calc_stats(data['first_byte'])
        total_stats = calc_stats(data['total'])
        
        connect_str = f"{connect_stats['mean']:.0f} ±{connect_stats['stdev']:.0f}" if connect_stats['mean'] else "N/A"
        fb_str = f"{fb_stats['mean']:.0f} ±{fb_stats['stdev']:.0f}" if fb_stats['mean'] else "N/A"
        total_str = f"{total_stats['mean']:.0f} ±{total_stats['stdev']:.0f}" if total_stats['mean'] else "N/A"
        
        lines.append(f"| {count} | {connect_str} | {fb_str} | {total_str} | {data['errors']} |")
    
    lines.append("")
    
    # Detailed stats
    lines.append("## Detailed Statistics")
    lines.append("")
    
    for count in sorted(latencies.keys()):
        data = latencies[count]
        lines.append(f"### {count} Concurrent Sessions")
        lines.append("")
        
        lines.append("| Metric | Count | Min | Max | Mean | Median | P95 | P99 |")
        lines.append("|--------|-------|-----|-----|------|--------|-----|-----|")
        
        for metric_name, values in [('Connect', data['connect']),
                                     ('First Byte', data['first_byte']),
                                     ('Total RT', data['total'])]:
            stats = calc_stats(values)
            if stats['count'] > 0:
                lines.append(f"| {metric_name} | {stats['count']} | {stats['min']} | {stats['max']} | "
                           f"{stats['mean']} | {stats['median']} | {stats['p95']} | {stats['p99']} |")
        
        lines.append("")
    
    # Scalability
    lines.append("## Scalability Assessment")
    lines.append("")
    
    counts = sorted(latencies.keys())
    if len(counts) >= 2:
        baseline_count = counts[0]
        baseline_fb = calc_stats(latencies[baseline_count]['first_byte'])
        
        if baseline_fb['mean']:
            lines.append(f"Baseline: {baseline_count} sessions @ {baseline_fb['mean']:.0f}ms mean first-byte latency")
            lines.append("")
            
            for count in counts[1:]:
                current_fb = calc_stats(latencies[count]['first_byte'])
                if current_fb['mean']:
                    increase = ((current_fb['mean'] - baseline_fb['mean']) / baseline_fb['mean']) * 100
                    emoji = "⚠️" if increase > 50 else "✅" if increase < 20 else "📊"
                    lines.append(f"- {emoji} **{count} sessions:** {current_fb['mean']:.0f}ms "
                               f"({'+' if increase > 0 else ''}{increase:.1f}% from baseline)")
            lines.append("")
    
    lines.append("---")
    lines.append(f"*Report generated: {datetime.utcnow().isoformat()}Z*")
    
    return "\n".join(lines)


def export_csv(latencies: dict, filepath: str):
    """Export raw latencies to CSV"""
    with open(filepath, 'w') as f:
        f.write("session_count,metric,value_ms\n")
        
        for count in sorted(latencies.keys()):
            data = latencies[count]
            for val in data['connect']:
                f.write(f"{count},connect,{val:.2f}\n")
            for val in data['first_byte']:
                f.write(f"{count},first_byte,{val:.2f}\n")
            for val in data['total']:
                f.write(f"{count},total,{val:.2f}\n")


def main():
    parser = argparse.ArgumentParser(description="Analyze LiveKit stress test results")
    parser.add_argument("results_file", type=str, help="Path to results JSON file")
    parser.add_argument("--format", choices=["text", "markdown", "json"], default="text",
                       help="Output format")
    parser.add_argument("--output", "-o", type=str, default=None,
                       help="Output file (default: stdout)")
    parser.add_argument("--csv", type=str, default=None,
                       help="Export raw latencies to CSV file")
    
    args = parser.parse_args()
    
    # Load results
    try:
        results = load_results(args.results_file)
    except FileNotFoundError:
        print(f"Error: File not found: {args.results_file}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Extract latencies
    latencies = extract_all_latencies(results)
    
    if not latencies:
        print("Error: No latency data found in results", file=sys.stderr)
        sys.exit(1)
    
    # Generate report
    if args.format == "text":
        report = format_text_report(results, latencies)
    elif args.format == "markdown":
        report = format_markdown_report(results, latencies)
    elif args.format == "json":
        # Build JSON summary
        summary = {}
        for count in sorted(latencies.keys()):
            data = latencies[count]
            summary[str(count)] = {
                'connect': calc_stats(data['connect']),
                'first_byte': calc_stats(data['first_byte']),
                'total': calc_stats(data['total']),
                'errors': data['errors'],
            }
        report = json.dumps(summary, indent=2)
    
    # Output
    if args.output:
        with open(args.output, 'w') as f:
            f.write(report)
        print(f"Report saved to: {args.output}")
    else:
        print(report)
    
    # Optional CSV export
    if args.csv:
        export_csv(latencies, args.csv)
        print(f"CSV exported to: {args.csv}")


if __name__ == "__main__":
    main()
