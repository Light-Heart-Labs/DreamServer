# RVC Extension for Dream Server

## Overview

RVC (Retrieval-based Voice Conversion) is a voice cloning and conversion system. Train voice models with just 10 minutes of audio data, then convert any voice to match your trained model.

## Features

- Train voice models with minimal data (≤10 mins)
- Real-time voice conversion
- Singing voice conversion
- Pre-trained model support
- GPU accelerated inference

## Usage

### Enable the extension

```bash
dream extensions enable rvc
```

### Access the WebUI

```
http://localhost:${RVC_PORT:-7865}
```

### Basic Workflow

1. **Prepare dataset**: Place audio files in `./data/rvc/dataset/`
2. **Process data**: Use the WebUI to preprocess and extract features
3. **Train model**: Train your voice model (30 mins - 4 hours depending on data)
4. **Convert voice**: Use trained model to convert new audio

## Data Directories

| Path | Purpose |
|------|---------|
| `./data/rvc/dataset/` | Training audio files |
| `./data/rvc/weights/` | Model weights and checkpoints |
| `./data/rvc/opt/` | Output converted audio |
| `./data/rvc/logs/` | Training logs, TensorBoard |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RVC_PORT` | 7865 | Web UI port |

## GPU Memory Requirements

| Quality | VRAM Required |
|---------|--------------|
| Low | 4 GB |
| Medium | 6 GB |
| High | 8+ GB |

## Integration

RVC works standalone for voice conversion. Combined with other extensions:
- **Piper TTS** → RVC: TTS output → voice conversion
- **Whisper** → RVC: Transcribe → convert voice → synthesize

## Uninstall

```bash
dream extensions disable rvc
```

Models and data in `./data/rvc/` are preserved.

## Documentation

- GitHub: <https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI>
- Models: <https://huggingface.co/lj1995/VoiceConversionWebUI>
