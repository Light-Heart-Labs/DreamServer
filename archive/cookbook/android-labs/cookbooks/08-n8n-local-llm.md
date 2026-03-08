# Recipe 06: n8n + Local LLM Integration

*Automate workflows with AI using your own hardware*

---

## Overview

n8n is a powerful workflow automation platform. Combined with local LLMs, you get:
- **Private AI automation** — data never leaves your network
- **Zero API costs** — no per-call pricing
- **Full control** — customize everything

**Missions:** M7 (OpenClaw Frontier), M9 (Open Source > Closed)

**Difficulty:** Intermediate | **Time:** 2-4 hours | **Prerequisites:** Basic Docker, REST APIs

---

## What is n8n?

n8n is an open-source workflow automation tool — think Zapier but self-hosted. It connects apps, services, and APIs through visual workflows.

**Why n8n + Local AI?**
- Build email auto-responders without sending data to OpenAI
- Create document processors that run entirely on-premise
- Automate reports with AI analysis using your own GPUs

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Your Network                         │
│                                                          │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐      │
│   │  Trigger │ ───► │   n8n    │ ───► │  Action  │      │
│   │ (email,  │      │ Workflow │      │ (Slack,  │      │
│   │  webhook,│      │          │      │  email,  │      │
│   │  cron)   │      │    │     │      │  file)   │      │
│   └──────────┘      │    │     │      └──────────┘      │
│                     │    ▼     │                         │
│                     │ ┌─────┐  │      ┌──────────┐      │
│                     │ │HTTP │──┼────► │  vLLM    │      │
│                     │ │Node │  │      │ (Local)  │      │
│                     │ └─────┘  │      └──────────┘      │
│                     └──────────┘                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Setup

### 1. n8n Installation (Docker)

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=changeme
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - WEBHOOK_URL=http://localhost:5678/
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

**Start:**
```bash
docker-compose up -d
# Access at http://localhost:5678
```

### 2. vLLM Setup

If you don't have vLLM running, add it to the compose:

```yaml
  vllm:
    image: vllm/vllm-openai:latest
    ports:
      - "8000:8000"
    command: >
      --model Qwen/Qwen2.5-32B-Instruct-AWQ
      --gpu-memory-utilization 0.9
      --max-model-len 32768
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

**Our cluster ports:**
- `9100` — Round-robin to Coder/Sage
- `9107` — Coder only (.122)
- `9108` — Sage only (.143)

---

## Connecting n8n to vLLM

### HTTP Request Node Configuration

In n8n, use the **HTTP Request** node to call your local LLM:

**Settings:**
- **Method:** POST
- **URL:** `http://192.168.0.122:9100/v1/chat/completions`
- **Authentication:** None (or Bearer if configured)
- **Body Content Type:** JSON

**JSON Body:**
```json
{
  "model": "Qwen/Qwen2.5-32B-Instruct-AWQ",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "{{ $json.message }}"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Extract Response:**
Add a **Set** node after to extract the response:
```
{{ $json.choices[0].message.content }}
```

---

## Example Workflows

### 1. Document Summarization Pipeline

**Trigger:** File uploaded to folder  
**Process:** Extract text → Summarize with LLM → Save summary

```
[Watch Folder] → [Read Binary File] → [Extract Text] → [HTTP Request (LLM)] → [Write File]
```

**HTTP Request Body:**
```json
{
  "model": "Qwen/Qwen2.5-32B-Instruct-AWQ",
  "messages": [
    {"role": "system", "content": "Summarize the following document in 3-5 bullet points."},
    {"role": "user", "content": "{{ $json.text }}"}
  ],
  "max_tokens": 500
}
```

---

### 2. Email Auto-Response

**Trigger:** New email received  
**Process:** Classify intent → Generate response → Queue for review

```
[Email Trigger] → [HTTP Request (Classify)] → [IF Node] → [HTTP Request (Generate)] → [Send Email]
```

**Classification prompt:**
```json
{
  "messages": [
    {"role": "system", "content": "Classify this email as: support, sales, spam, or other. Reply with just the category."},
    {"role": "user", "content": "Subject: {{ $json.subject }}\n\n{{ $json.body }}"}
  ]
}
```

**Response generation:**
```json
{
  "messages": [
    {"role": "system", "content": "Draft a professional response to this email. Be helpful and concise."},
    {"role": "user", "content": "Email:\n{{ $json.body }}\n\nDraft a response:"}
  ]
}
```

---

### 3. Slack/Discord Bot

**Trigger:** Slack message in channel  
**Process:** Call LLM → Reply in thread

```
[Slack Trigger] → [HTTP Request (LLM)] → [Slack (Reply)]
```

**Slack app configuration:**
1. Create Slack App at api.slack.com
2. Add "chat:write" and "channels:read" scopes
3. Install to workspace
4. Use OAuth token in n8n Slack credential

**LLM Prompt:**
```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful team assistant. Answer questions concisely."},
    {"role": "user", "content": "{{ $json.event.text }}"}
  ]
}
```

---

### 4. RAG Pipeline with Webhooks

**Trigger:** Webhook call  
**Process:** Embed query → Search vectors → Generate with context

```
[Webhook] → [HTTP (Embeddings)] → [HTTP (Qdrant)] → [HTTP (LLM)] → [Respond to Webhook]
```

**Embeddings call:**
```json
POST http://192.168.0.122:9103/v1/embeddings
{
  "model": "BAAI/bge-large-en-v1.5",
  "input": "{{ $json.query }}"
}
```

**Qdrant search:**
```json
POST http://192.168.0.122:9106/collections/docs/points/search
{
  "vector": {{ $json.data[0].embedding }},
  "limit": 5,
  "with_payload": true
}
```

**LLM with context:**
```json
{
  "messages": [
    {"role": "system", "content": "Answer the question using only the provided context."},
    {"role": "user", "content": "Context:\n{{ $json.result.map(r => r.payload.text).join('\n\n') }}\n\nQuestion: {{ $node['Webhook'].json.query }}"}
  ]
}
```

---

### 5. Automated Report Generation

**Trigger:** Cron (daily/weekly)  
**Process:** Fetch data → Analyze with LLM → Generate report → Email

```
[Schedule Trigger] → [HTTP (API)] → [HTTP (LLM Analysis)] → [Convert to PDF] → [Send Email]
```

**Analysis prompt:**
```json
{
  "messages": [
    {"role": "system", "content": "Analyze this data and provide insights in a professional report format with sections: Summary, Key Findings, Recommendations."},
    {"role": "user", "content": "Data:\n{{ JSON.stringify($json.data, null, 2) }}"}
  ]
}
```

---

## Error Handling

### Retry on Failure

In HTTP Request node settings:
- **On Error:** Continue (using error output)
- **Retry on Fail:** Yes
- **Max Tries:** 3
- **Wait Between Tries:** 1000ms

### Timeout Handling

LLM calls can be slow. Configure:
- **Timeout:** 120000 (2 minutes)

### Error Notification

Add an **IF** node to check for errors:
```
{{ $json.error !== undefined }}
```

Then route to notification (Slack, email).

---

## Credential Management

### Store API Keys Securely

In n8n, use **Credentials** for sensitive data:

1. Go to Settings → Credentials
2. Create "Header Auth" credential
3. Name: `Authorization`
4. Value: `Bearer your-api-key`

Use in HTTP Request:
- **Authentication:** Predefined Credential Type
- **Credential Type:** Header Auth

### Environment Variables

For sensitive data, use env vars:

```yaml
environment:
  - VLLM_API_KEY=${VLLM_API_KEY}
```

Access in n8n: `{{ $env.VLLM_API_KEY }}`

---

## Performance Considerations

### 1. Batch Processing

For bulk operations, use the **Split In Batches** node:
- Process 10 items at a time
- Prevents overwhelming the LLM

### 2. Caching

Add a **Redis** node to cache frequent queries:
```
[Check Cache] → [IF Found] → [Return Cached]
                     ↓ (not found)
             [LLM] → [Store in Cache] → [Return]
```

### 3. Queue Long Jobs

For heavy processing, use a queue:
- **RabbitMQ** or **Redis** for job queue
- Separate worker for LLM calls
- Webhook callback when complete

### 4. Model Selection

Route based on complexity:
```
[IF Simple] → [Fast Model (7B)]
     ↓
[Complex] → [Large Model (32B)]
```

---

## Scaling Workflows

### Horizontal Scaling

Run multiple n8n workers:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    deploy:
      replicas: 3
    environment:
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=redis
```

### Webhook Load Balancing

Use nginx in front:

```nginx
upstream n8n {
    server n8n1:5678;
    server n8n2:5678;
    server n8n3:5678;
}
```

### Separate LLM Workers

Dedicate GPUs to different tasks:
- Port 9107: Fast queries (Coder)
- Port 9108: Complex reasoning (Sage)
- Port 9100: Round-robin for balance

---

## Common Pitfalls

| Problem | Cause | Solution |
|---------|-------|----------|
| Timeout errors | LLM too slow | Increase timeout to 120s+ |
| JSON parse fails | LLM returns malformed JSON | Add "respond only with valid JSON" to prompt |
| Rate limiting | Too many concurrent calls | Add delays, use batching |
| Memory issues | Large payloads | Stream or chunk large documents |
| Wrong model | Hardcoded model name | Use variables for flexibility |

---

## Templates

### Basic LLM Call Function
Save as reusable workflow:

```json
{
  "name": "LLM Call",
  "nodes": [
    {
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "={{ $workflow.variables.vllm_url }}/v1/chat/completions",
        "bodyContentType": "json",
        "body": {
          "model": "={{ $workflow.variables.model }}",
          "messages": "={{ $input.all() }}"
        }
      }
    }
  ]
}
```

### Error Handler Template
```json
{
  "nodes": [
    {
      "type": "n8n-nodes-base.if",
      "parameters": {
        "conditions": {
          "string": [{"value1": "={{ $json.error }}", "operation": "isNotEmpty"}]
        }
      }
    },
    {
      "type": "n8n-nodes-base.slack",
      "parameters": {
        "channel": "#alerts",
        "message": "Workflow error: {{ $json.error }}"
      }
    }
  ]
}
```

---

## Complete Example: Support Ticket Triage

**Full workflow:**

1. **Email Trigger** — New support email
2. **Extract Data** — Get subject, body, sender
3. **Classify Priority** — LLM call to determine urgency
4. **Extract Entities** — LLM call to get product, issue type
5. **Create Ticket** — API call to ticketing system
6. **Route** — Assign to appropriate team
7. **Auto-Reply** — Generate and send acknowledgment

**Workflow JSON snippet:**
```json
{
  "nodes": [
    {
      "name": "Email Trigger",
      "type": "n8n-nodes-base.emailReadImap"
    },
    {
      "name": "Classify Priority",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://192.168.0.122:9100/v1/chat/completions",
        "body": {
          "messages": [
            {"role": "system", "content": "Classify this support email priority as: critical, high, medium, low. Reply with just the priority."},
            {"role": "user", "content": "Subject: {{ $json.subject }}\n\n{{ $json.text }}"}
          ]
        }
      }
    }
  ]
}
```

---

## Next Steps

1. **Build your first workflow** — Start with document summarization
2. **Add monitoring** — Track success rates and latency
3. **Create templates** — Reusable LLM nodes for common tasks
4. **Explore integrations** — n8n has 400+ integrations to connect

---

## References

- [n8n Documentation](https://docs.n8n.io)
- [vLLM OpenAI Compatible Server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)
- [n8n Community Workflows](https://n8n.io/workflows)

---

*Part of the Android-Labs Cookbook — M7, M9*
