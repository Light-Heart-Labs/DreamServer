# Jupyter Extension

Interactive computing environment with Python, R, and Julia support.

## Overview

Jupyter Notebook provides an interactive environment for scientific computing, data analysis, and machine learning. This extension includes scientific Python packages pre-installed.

## Features

- **Interactive Notebooks**: Create and share documents with code and visualizations
- **Multiple Languages**: Python, R, Julia support
- **Scientific Stack**: NumPy, SciPy, Pandas, Matplotlib, Scikit-learn pre-installed
- **Web Interface**: Access via web browser on port 8888

## Configuration

### Environment Variables

- `JUPYTER_PORT` - Port for web interface (default: 8888)
- `JUPYTER_TOKEN` - Authentication token (default: jupyter)
- `LLM_API_URL` - URL for your LLM API (from .env)

### Volumes

- `./data/jupyter/workspaces` - Project workspaces
- `./data/jupyter/notebooks` - Notebook storage
- `${PWD}` - Current workspace (read-only)

### Ports

- `8888` - Web interface

## Quick Start

```bash
# Add to your dream-server/extensions/enabled.yaml
- jupyter

# Start the extension
cd dream-server
./dream.sh up jupyter

# Or with docker-compose
docker-compose -f extensions/services/jupyter/compose.yaml up -d
```

## Usage

### Web Interface

Access the web interface at `http://localhost:8888`.

Default token: `jupyter`

### Creating a New Notebook

1. Click "New" → "Python 3" in the file browser
2. Start coding with interactive cells
3. Run cells with Shift+Enter

### Integration with LLM

Use the LLM_API_URL environment variable to connect to your local LLM for AI assistance in notebooks.

## Links

- [Jupyter Documentation](https://jupyter.org/documentation)
- [Scipy-Notebook Image](https://hub.docker.com/r/jupyter/scipy-notebook)
