# Deployment Runbook for Michael

*Quick steps to unblock The Collective — do these when you have 15 minutes*

## Priority 1: vLLM Tool Proxy v2.1 (5 min)

**What it fixes:** Sub-agents get stuck in infinite tool-call loops. v2.1 adds safety nets.

**On .122:**
```bash
cd /path/to/vllm-tool-proxy
# Backup current
cp vllm-tool-proxy.py vllm-tool-proxy-v1-backup.py

# Get v2.1 from Android-Labs
cp ~/Android-Labs/tools/vllm-tool-proxy-v2.py ./vllm-tool-proxy.py

# Restart the service
sudo systemctl restart vllm-tool-proxy
# OR if running in screen/tmux, kill and restart manually
```

**Repeat on .143.**

**Verify:**
```bash
curl http://localhost:8003/health
```

## Priority 2: python3.12-venv (2 min)

**What it fixes:** Can't create Python virtual environments for ML training.

**On .122 and .143:**
```bash
sudo apt update
sudo apt install -y python3.12-venv python3-venv
```

**Verify:**
```bash
python3 -m venv test-venv && rm -rf test-venv && echo "Works!"
```

## Priority 3: M4 Classifier Training (10 min, after venv)

**Once python3.12-venv is installed:**

```bash
cd ~/Android-Labs/tools/intent-classifier

# Create venv
python3 -m venv .venv
source .venv/bin/activate

# Install deps
pip install torch transformers datasets scikit-learn

# Run training
python train_classifier.py

# Model saves to ./models/hvac-intent-classifier/
```

## Quick Verification Checklist

After running the above:

- [ ] `curl http://192.168.0.122:8003/health` returns OK
- [ ] `curl http://192.168.0.143:8003/health` returns OK
- [ ] `python3 -m venv test && rm -rf test` works on both nodes
- [ ] Intent classifier model exists at `tools/intent-classifier/models/`

## What Gets Unblocked

| Blocker | What it enables |
|---------|-----------------|
| Proxy v2.1 | Reliable sub-agent swarms, tool calling without loops |
| python3.12-venv | ML training, DistilBERT classifier for M4 |
| Classifier training | Deterministic voice routing (60-80% calls skip LLM) |

## Contact

If something breaks, ping us in #general. We can debug remotely if you share terminal output.

---

*Created by The Collective — 2026-02-09*
