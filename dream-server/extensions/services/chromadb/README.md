# ChromaDB Extension for Dream Server

## Overview

ChromaDB is an AI-native open-source vector database designed for building embeddings-based applications with a focus on developer productivity and ease of use.

## Features

- Vector search with metadata filtering
- Multiple embedding functions support
- Persistent storage for embeddings and metadata
- REST API for easy integration
- GPU acceleration not required (CPU-based)

## Usage

### Enable the extension

```bash
dream extensions enable chromadb
```

### Access the API

```
http://localhost:${CHROMADB_PORT:-8000}
```

### Health Check

```bash
curl http://localhost:8000/api/v1/heartbeat
```

## Integration

ChromaDB integrates with:
- **n8n workflows** — Vector search and storage nodes
- **Custom applications** — Direct HTTP API access
- **Embeddings service** — Store and query vector embeddings

## API Examples

### Create a collection
```bash
curl -X POST http://localhost:8000/api/v1/collections \
  -H "Content-Type: application/json" \
  -d '{"name": "my_collection"}'
```

### Add embeddings
```bash
curl -X POST http://localhost:8000/api/v1/collections/my_collection/add \
  -H "Content-Type: application/json" \
  -d '{
    "ids": ["doc1", "doc2"],
    "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]],
    "metadatas": [{"source": "doc1"}, {"source": "doc2"}]
  }'
```

## Uninstall

```bash
dream extensions disable chromadb
```

This removes the container. Your data in `./data/chromadb/` is preserved.
