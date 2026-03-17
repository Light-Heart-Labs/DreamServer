# Dream Server Installation Troubleshooting Guide

This guide provides solutions for common issues encountered during the installation of Dream Server.

## Environment Validation (PR-17)

Dream Server now validates `.env` with a strict parser (quoted values, inline comments, mode-aware requirements).

### Problem: Installer fails with `.env` validation error
**Symptoms:** installer stops after generating `.env`, or logs mention `validate-env.sh`.

**Fix:**
```bash
cd ~/dream-server
./scripts/validate-env.sh --strict
```

### Problem: You need machine-readable validation output
**Fix:**
```bash
./scripts/validate-env.sh --json > /tmp/env-validation.json
```

### Problem: Deprecated keys are present (`LLAMA_SERVER_PORT`, `MAX_CONTEXT`)
**Fix:**
```bash
./scripts/migrate-config.sh autofix-env
./scripts/validate-env.sh --strict
```

### Mode requirements
- `DREAM_MODE=local`: local model keys required.
- `DREAM_MODE=cloud`: requires at least one cloud API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `TOGETHER_API_KEY`).
- `DREAM_MODE=hybrid`: requires local model keys plus at least one cloud API key.

## Docker Issues

### Problem: Docker Not Installed
**Solution:** Install Docker by following the official [Docker installation guide](https://docs.docker.com/get-docker/).

### Problem: Docker Service Not Running
**Solution:** Start the Docker service.

```bash
sudo systemctl start docker
```

### Problem: Permission Denied When Running Docker Commands
**Solution:** Add your user to the Docker group.

```bash
sudo usermod -aG docker $USER
```
Then, log out and back in to apply the changes.

## GPU Detection Issues

### Problem: GPU Not Detected
**Solution:** Ensure that the NVIDIA drivers are installed and that the NVIDIA Container Toolkit is set up correctly.

Install NVIDIA Drivers:
```bash
sudo apt-get install nvidia-driver-<version>
```

Install NVIDIA Container Toolkit:
```bash
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

Verify GPU detection:
```bash
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

## Port Conflicts

### Problem: Port Already in Use
**Solution:** Identify and stop the process using the port.

Find the process ID (PID) using the port:
```bash
sudo lsof -i :<port_number>
```

Stop the process:
```bash
sudo kill -9 <PID>
```

## Model Download Failures

### Problem: Model Download Fails Due to Network Issues
**Solution:** Ensure a stable internet connection and retry the download.

### Problem: Insufficient Disk Space
**Solution:** Free up disk space and retry the download.

Check disk usage:
```bash
df -h
```

## Health Check Timeouts

### Problem: Health Checks Fail Due to Timeout
**Solution:** Increase the timeout settings or check the server's health manually.

Increase timeout settings in the compose file (e.g., `docker-compose.base.yml`).

Check server health:
```bash
curl http://localhost:<port>/health
```
