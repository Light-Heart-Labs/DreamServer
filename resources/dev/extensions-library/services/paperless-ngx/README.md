# Paperless-ngx

AI-powered document management system for scanning, indexing, and organizing physical documents.

## Overview

Paperless-ngx automatically organizes scanned documents with OCR, categorization, and semantic search capabilities.

## Features

- **Document Management**: Organize and search scanned documents
- **OCR**: Optical Character Recognition for scanned docs
- **Categorization**: AI-powered automatic categorization
- **Search**: Full-text and semantic search

## Configuration

- **Port**: `PAPERLESS_PORT` (default: 7807)
- **Data Directory**: `./data/paperless`

## Usage

After installation, access the web interface at `http://localhost:7807`

## Requirements

- 4GB+ RAM recommended
- No GPU required

## Dependencies

This extension requires:
- PostgreSQL (database)
- Redis (caching)
