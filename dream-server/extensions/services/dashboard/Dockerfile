# Dream Server Dashboard
# Multi-stage build: React SPA → nginx static serving

# Stage 1: Build React app
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install --no-frozen-lockfile

# Copy source files
COPY . .

# Build the React app
RUN bun run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built app from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
# B1 fix: Copy directly to conf.d (not templates) since we override ENTRYPOINT
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script for runtime auth configuration
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Expose port 3001
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3001/ || exit 1

# Run entrypoint (configures nginx, then starts it)
ENTRYPOINT ["/entrypoint.sh"]
