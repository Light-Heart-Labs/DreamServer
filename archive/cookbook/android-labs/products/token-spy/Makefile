.PHONY: setup start stop logs restart test clean help

# Default target
help:
	@echo "Token Spy - Available Commands"
	@echo ""
	@echo "  make setup    - Create .env from template (first-time setup)"
	@echo "  make start    - Start all services"
	@echo "  make stop     - Stop all services"
	@echo "  make restart  - Restart all services"
	@echo "  make logs     - Tail service logs"
	@echo "  make test     - Run test suite"
	@echo "  make clean    - Remove containers and volumes"
	@echo ""

# First-time setup
setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example"; \
		echo "⚠️  IMPORTANT: Edit .env and set your secrets before starting!"; \
	else \
		echo ".env already exists - skipping"; \
	fi

# Start services
start:
	@if [ ! -f .env ]; then \
		echo "❌ No .env file found. Run 'make setup' first."; \
		exit 1; \
	fi
	docker compose up -d
	@echo ""
	@echo "✅ Token Spy started!"
	@echo "   Dashboard: http://localhost:3000"
	@echo "   Proxy:     http://localhost:8080"
	@echo "   API:       http://localhost:8000"
	@echo ""

# Stop services
stop:
	docker compose down

# Restart services
restart: stop start

# View logs
logs:
	docker compose logs -f

# Run tests
test:
	docker compose exec sidecar python -m pytest tests/ -v || \
		echo "Run tests locally: cd sidecar && python -m pytest tests/ -v"

# Clean up everything
clean:
	docker compose down -v --remove-orphans
	@echo "Removed containers and volumes"
