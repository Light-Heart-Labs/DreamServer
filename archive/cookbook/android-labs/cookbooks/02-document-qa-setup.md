# Recipe 2: Local Document Q&A System

*Local AI Cookbook | 2026-02-09*

A practical guide for building a RAG-based document Q&A system with local models.

---

## Components

| Component | Purpose | Options |
|-----------|---------|---------|
| **Embeddings** | Vector representation | BGE, E5, Sentence Transformers |
| **Vector DB** | Similarity search | Qdrant, ChromaDB, FAISS |
| **LLM** | Answer generation | Qwen, Llama via vLLM |

---

## Hardware Requirements

### CPU-only (small datasets)
- **RAM:** 16 GB
- **Storage:** 50 GB SSD
- Suitable for: <10K documents, low QPS

### GPU-accelerated (production)
- **GPU:** RTX 4090 24GB or better
- **RAM:** 32 GB
- **Storage:** 100 GB NVMe SSD
- Suitable for: Large document sets, real-time queries

---

## Choosing an Embedding Model

| Model | Dimensions | Quality | Speed |
|-------|------------|---------|-------|
| `all-MiniLM-L6-v2` | 384 | Good | Fast |
| `bge-large-en-v1.5` | 1024 | Excellent | Medium |
| `e5-large-v2` | 1024 | Excellent | Medium |
| `nomic-embed-text-v1` | 768 | Very Good | Fast |

**Recommendation:** Start with `all-MiniLM-L6-v2` for prototyping, upgrade to `bge-large` for production.

---

## Vector Database Setup

### Option A: Qdrant (Recommended)

```bash
# Run via Docker
docker run -d --name qdrant \
  -p 6333:6333 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# Verify
curl http://localhost:6333/health
```

**Light Heart Cluster:** Qdrant available at `192.168.0.122:9106` (nginx proxy)

### Option B: ChromaDB (Simpler)

```bash
pip install chromadb

# In Python
import chromadb
client = chromadb.PersistentClient(path="./chroma_db")
collection = client.create_collection("documents")
```

---

## RAG Pipeline Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │────▶│  Embeddings │────▶│  Vector DB  │
│   Query     │     │   Model     │     │   Search    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐     ┌──────▼──────┐
                    │   Answer    │◀────│    LLM      │
                    │             │     │  (vLLM)     │
                    └─────────────┘     └─────────────┘
```

---

## Document Chunking Strategies

### Fixed-size chunks
```python
def chunk_text(text, chunk_size=512, overlap=50):
    chunks = []
    for i in range(0, len(text), chunk_size - overlap):
        chunks.append(text[i:i + chunk_size])
    return chunks
```

### Semantic chunking (better quality)
```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", ". ", " ", ""]
)
chunks = splitter.split_text(document)
```

**Best practices:**
- Chunk size: 256-512 tokens for most use cases
- Overlap: 10-20% of chunk size
- Preserve paragraph/sentence boundaries when possible

---

## Complete Implementation

```python
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from openai import OpenAI

# Initialize components
embedder = SentenceTransformer('all-MiniLM-L6-v2')

# Local dev: localhost:6333 | Light Heart Cluster: 192.168.0.122:9106
qdrant = QdrantClient("192.168.0.122", port=9106)

# .143 for general, .122 for code-focused
llm = OpenAI(base_url="http://192.168.0.143:8000/v1", api_key="none")

# Create collection
qdrant.create_collection(
    collection_name="docs",
    vectors_config=VectorParams(size=384, distance=Distance.COSINE)
)

# Index documents
def index_document(doc_id: str, text: str):
    chunks = chunk_text(text)
    for i, chunk in enumerate(chunks):
        vector = embedder.encode(chunk).tolist()
        qdrant.upsert(
            collection_name="docs",
            points=[PointStruct(
                id=f"{doc_id}_{i}",
                vector=vector,
                payload={"text": chunk, "doc_id": doc_id}
            )]
        )

# Query
def query(question: str, top_k: int = 3):
    query_vector = embedder.encode(question).tolist()
    results = qdrant.search(
        collection_name="docs",
        query_vector=query_vector,
        limit=top_k
    )
    
    context = "\n\n".join([r.payload["text"] for r in results])
    
    # Model must match endpoint: .143 = 32B, .122 = Coder-32B
    response = llm.chat.completions.create(
        model="Qwen/Qwen2.5-32B-Instruct-AWQ",
        messages=[
            {"role": "system", "content": f"Answer based on this context:\n{context}"},
            {"role": "user", "content": question}
        ]
    )
    
    return response.choices[0].message.content
```

---

## Query Optimization Tips

1. **Hybrid search:** Combine vector + keyword search for better recall
2. **Re-ranking:** Use a cross-encoder to re-rank initial results
3. **Query expansion:** Generate multiple query variations
4. **Metadata filtering:** Use doc type, date, etc. to narrow search

---

*This recipe is part of the Local AI Cookbook — practical guides for self-hosted AI systems.*
