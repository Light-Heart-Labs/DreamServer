# Auto Claude

Auto Claude is a desktop application. All functionality is accessed through the Electron desktop UI.

## Getting Started

1. Download the latest release for your platform from the [Releases page](https://github.com/AndyMik90/Auto-Claude/releases)
2. Install and launch the application
3. Open your project (a git repository folder)
4. Connect Claude via the OAuth setup guide in the app
5. Create a task and let the agents work

## Running the App from Source

```bash
# Install dependencies
npm run install:all

# Development mode (hot reload)
npm run dev

# Production build + run
npm start
```

## Configuration

All configuration is done through the app's Settings UI. You can:

- Connect Claude accounts (OAuth or API key)
- Configure multiple provider profiles (Anthropic, OpenAI, Google, etc.)
- Enable the Graphiti memory system
- Set default models and thinking budgets
- Configure Linear/GitHub/GitLab integrations
