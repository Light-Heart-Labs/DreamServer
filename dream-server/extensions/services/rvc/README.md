# RVC Extension

Retrieval-Based Voice Conversion - Local AI voice conversion with web UI.

## Overview

RVC (Retrieval-Based Voice Conversion) is an open-source voice conversion framework that allows you to transform voices while preserving the original characteristics. This extension provides a web interface for easy voice manipulation.

## Features

- **Voice Conversion**: Transform voices while preserving speaker characteristics
- **Web UI**: Easy-to-use interface on port 7860
- **Local Processing**: All processing happens locally
- **Multiple Models**: Support for various RVC models

## Configuration

### Environment Variables

- `RVC_PORT` - Port for web interface (default: 7860)
- `LLM_API_URL` - URL for your LLM API (from .env)

### Volumes

- `./data/rvc/models` - RVC models storage
- `./data/rvc/voices` - Input/output voices
- `./data/rvc/index` - Index files for voice conversion
- `./data/rvc/logs` - Processing logs

### Ports

- `7860` - Web interface

## Quick Start

```bash
# Add to your dream-server/extensions/enabled.yaml
- rvc

# Start the extension
cd dream-server
./dream.sh up rvc

# Or with docker-compose
docker-compose -f extensions/services/rvc/compose.yaml up -d
```

## Usage

### Web Interface

Access the web interface at `http://localhost:7860`.

### Voice Conversion Workflow

1. Upload your source voice audio
2. Select a pre-trained RVC model
3. Configure conversion parameters
4. Process and download converted audio

## Links

- [RVC GitHub](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)
- [Docker Hub](https://hub.docker.com/_/python)
