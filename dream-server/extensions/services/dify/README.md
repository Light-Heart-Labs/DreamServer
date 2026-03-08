# Dify (AI Workflow Builder) Extension

**Status:** ⚠️ Skipped - Complex multi-container setup required

Dify uses separate images for API and web frontend (`langgenius/dify-api` + `langgenius/dify-web`) which makes it incompatible with the simple single-service extension pattern used by other Dream Server extensions.

## Alternative: Use Dify's Official Docker Compose

For users who want Dify, they can use the official Docker Compose setup:

```bash
git clone https://github.com/langgenius/dify.git
cd docker
cp .env.example .env
docker compose up -d
```

## See Also

- [Dify GitHub](https://github.com/langgenius/dify)
- [Dify Docker Compose](https://github.com/langgenius/dify/blob/main/docker/docker-compose.yaml)
