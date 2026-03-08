#!/usr/bin/env python3
"""
GPU Temperature Monitor — Discord Alert System

Monitors both nodes (.122, .143) for GPU temperature and VRAM usage.
Posts alerts to Discord when thresholds are exceeded.
"""

import requests
import json
import time
import argparse
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass

# Discord webhook (to be configured)
DISCORD_WEBHOOK_URL = None  # Set via env var or --webhook

NODES = {
    ".122": "192.168.0.122",
    ".143": "192.168.0.143"
}

DEFAULT_THRESHOLDS = {
    "temp_c": 80,      # Alert if GPU temp > 80°C
    "vram_percent": 95, # Alert if VRAM usage > 95%
    "power_w": 500     # Alert if power draw > 500W
}

@dataclass
class GPUStats:
    node: str
    timestamp: str
    gpu_name: str
    temp_c: float
    power_w: float
    vram_used_mb: int
    vram_total_mb: int
    vram_percent: float
    gpu_util: float
    healthy: bool

class GPUMonitor:
    """Monitor GPU stats across the cluster and alert on Discord."""
    
    def __init__(
        self,
        discord_webhook: Optional[str] = None,
        thresholds: Optional[Dict] = None,
        check_interval: int = 60
    ):
        self.discord_webhook = discord_webhook
        self.thresholds = thresholds or DEFAULT_THRESHOLDS
        self.check_interval = check_interval
        self.alert_cooldown = {}  # Track last alert per node/metric
        
    def get_gpu_stats(self, node_ip: str) -> Optional[GPUStats]:
        """Query GPU stats via SSH/nvidia-smi."""
        import subprocess
        
        try:
            # Run nvidia-smi via SSH
            result = subprocess.run(
                ["ssh", f"michael@{node_ip}", 
                 "nvidia-smi --query-gpu=name,temperature.gpu,power.draw,memory.used,memory.total,utilization.gpu "
                 "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode != 0:
                return None
            
            # Parse output: name, temp, power, mem_used, mem_total, util
            parts = result.stdout.strip().split(", ")
            if len(parts) < 6:
                return None
            
            gpu_name = parts[0]
            temp_c = float(parts[1])
            power_w = float(parts[2].replace(" W", ""))
            vram_used = int(parts[3])
            vram_total = int(parts[4])
            gpu_util = float(parts[5])
            
            vram_percent = (vram_used / vram_total) * 100
            
            # Determine health
            healthy = (
                temp_c < self.thresholds["temp_c"] and
                vram_percent < self.thresholds["vram_percent"] and
                power_w < self.thresholds["power_w"]
            )
            
            return GPUStats(
                node=node_ip,
                timestamp=datetime.now().isoformat(),
                gpu_name=gpu_name,
                temp_c=temp_c,
                power_w=power_w,
                vram_used_mb=vram_used,
                vram_total_mb=vram_total,
                vram_percent=vram_percent,
                gpu_util=gpu_util,
                healthy=healthy
            )
            
        except Exception as e:
            print(f"Error querying {node_ip}: {e}")
            return None
    
    def send_discord_alert(self, stats: GPUStats, alert_type: str, message: str):
        """Send alert to Discord webhook."""
        if not self.discord_webhook:
            print(f"[ALERT - no webhook] {message}")
            return
        
        # Color based on severity
        color = 0xff0000 if alert_type == "CRITICAL" else 0xffa500
        
        embed = {
            "title": f"🚨 GPU Alert: {stats.node}",
            "description": message,
            "color": color,
            "fields": [
                {"name": "GPU", "value": stats.gpu_name[:50], "inline": True},
                {"name": "Temperature", "value": f"{stats.temp_c:.1f}°C", "inline": True},
                {"name": "Power", "value": f"{stats.power_w:.0f}W", "inline": True},
                {"name": "VRAM", "value": f"{stats.vram_percent:.1f}% ({stats.vram_used_mb}/{stats.vram_total_mb} MB)", "inline": True},
                {"name": "Utilization", "value": f"{stats.gpu_util:.1f}%", "inline": True},
                {"name": "Time", "value": stats.timestamp, "inline": False}
            ],
            "footer": {"text": "GPU Monitor"}
        }
        
        payload = {"embeds": [embed]}
        
        try:
            resp = requests.post(
                self.discord_webhook,
                json=payload,
                timeout=10
            )
            return resp.status_code == 204
        except Exception as e:
            print(f"Failed to send Discord alert: {e}")
            return False
    
    def check_thresholds(self, stats: GPUStats) -> List[str]:
        """Check which thresholds are exceeded."""
        alerts = []
        
        if stats.temp_c > self.thresholds["temp_c"]:
            alerts.append(f"Temperature {stats.temp_c:.1f}°C > {self.thresholds['temp_c']}°C")
        
        if stats.vram_percent > self.thresholds["vram_percent"]:
            alerts.append(f"VRAM {stats.vram_percent:.1f}% > {self.thresholds['vram_percent']}%")
        
        if stats.power_w > self.thresholds["power_w"]:
            alerts.append(f"Power {stats.power_w:.0f}W > {self.thresholds['power_w']}W")
        
        return alerts
    
    def check_cooldown(self, node: str, alert_type: str) -> bool:
        """Check if we're in cooldown for this alert."""
        key = f"{node}:{alert_type}"
        now = time.time()
        last_alert = self.alert_cooldown.get(key, 0)
        
        # 5-minute cooldown between same alerts
        if now - last_alert < 300:
            return False
        
        self.alert_cooldown[key] = now
        return True
    
    def check_once(self, verbose: bool = False) -> Dict:
        """Run a single check cycle."""
        results = {}
        
        for node_name, node_ip in NODES.items():
            if verbose:
                print(f"Checking {node_name} ({node_ip})...")
            
            stats = self.get_gpu_stats(node_ip)
            results[node_name] = stats
            
            if stats is None:
                if verbose:
                    print(f"  ✗ Failed to query GPU")
                continue
            
            # Check thresholds
            alerts = self.check_thresholds(stats)
            
            if alerts:
                alert_msg = "; ".join(alerts)
                if verbose:
                    print(f"  ⚠️  ALERT: {alert_msg}")
                
                # Send Discord alert (with cooldown)
                if self.check_cooldown(node_name, "threshold"):
                    self.send_discord_alert(stats, "WARNING", alert_msg)
            else:
                if verbose:
                    print(f"  ✓ Healthy: {stats.temp_c:.1f}°C, {stats.vram_percent:.1f}% VRAM")
        
        return results
    
    def run_continuous(self, duration_minutes: Optional[int] = None):
        """Run continuous monitoring."""
        print(f"GPU Monitor started (interval: {self.check_interval}s)")
        print(f"Thresholds: {self.thresholds}")
        print("-" * 50)
        
        start_time = time.time()
        cycle = 0
        
        while True:
            cycle += 1
            print(f"\n[Cycle {cycle}] {datetime.now().strftime('%H:%M:%S')}")
            
            results = self.check_once(verbose=True)
            
            # Check if duration exceeded
            if duration_minutes:
                elapsed = (time.time() - start_time) / 60
                if elapsed >= duration_minutes:
                    print(f"\nDuration limit ({duration_minutes}min) reached. Stopping.")
                    break
            
            # Sleep until next check
            time.sleep(self.check_interval)
    
    def print_summary(self, results: Dict):
        """Print formatted summary of results."""
        print("\n" + "=" * 60)
        print("GPU STATUS SUMMARY")
        print("=" * 60)
        
        for node_name, stats in results.items():
            if stats is None:
                print(f"\n{node_name}: ❌ UNREACHABLE")
                continue
            
            status = "✅ HEALTHY" if stats.healthy else "🔥 ALERT"
            print(f"\n{node_name}: {status}")
            print(f"  GPU: {stats.gpu_name}")
            print(f"  Temp: {stats.temp_c:.1f}°C (threshold: {self.thresholds['temp_c']}°C)")
            print(f"  VRAM: {stats.vram_percent:.1f}% ({stats.vram_used_mb}/{stats.vram_total_mb} MB)")
            print(f"  Power: {stats.power_w:.0f}W")
            print(f"  Util: {stats.gpu_util:.1f}%")


def main():
    parser = argparse.ArgumentParser(description="GPU Temperature Monitor")
    parser.add_argument("--webhook", help="Discord webhook URL")
    parser.add_argument("--temp-threshold", type=int, default=80, help="Temperature threshold (°C)")
    parser.add_argument("--vram-threshold", type=int, default=95, help="VRAM threshold (%)")
    parser.add_argument("--interval", type=int, default=60, help="Check interval (seconds)")
    parser.add_argument("--duration", type=int, help="Run duration (minutes)")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    
    args = parser.parse_args()
    
    # Get webhook from env or arg
    webhook = args.webhook or DISCORD_WEBHOOK_URL
    
    thresholds = {
        "temp_c": args.temp_threshold,
        "vram_percent": args.vram_threshold,
        "power_w": 500
    }
    
    monitor = GPUMonitor(
        discord_webhook=webhook,
        thresholds=thresholds,
        check_interval=args.interval
    )
    
    if args.once:
        results = monitor.check_once(verbose=True)
        monitor.print_summary(results)
    else:
        monitor.run_continuous(duration_minutes=args.duration)


if __name__ == "__main__":
    main()
