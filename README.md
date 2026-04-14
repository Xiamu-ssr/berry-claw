# Berry-Claw 🐾

AI agent product built on [berry-agent-sdk](https://github.com/Xiamu-ssr/berry-agent-sdk) — eating our own dog food.

## What It Does

A web-based AI agent with chat UI, multi-provider support, and full observability dashboard.

## Architecture

```
Web UI (React + Vite)  ←→  WebSocket + REST  ←→  server.ts
                                                     ↓
                                              AgentManager
                                           ↙       ↓        ↘
                                  ConfigManager  Agent    Observer
                                  (providers)   (core)   (observe)
                                                  ↓
                                            tools-common
                                        (10 pre-built tools)
```

## SDK Integration

| SDK Package | Usage in Berry-Claw |
|-------------|-------------------|
| @berry-agent/core | Agent loop, sessions, providers |
| @berry-agent/tools-common | All tools (zero custom tool code) |
| @berry-agent/observe | `createObserveRouter()` — one line to add 14 API endpoints |
| @berry-agent/safe | `compositeGuard(directoryScope, denyList)` |

**Backend**: 793 lines — because the SDK does the heavy lifting.

## Features

- **Multi-provider**: Register Anthropic/OpenAI/etc., route by model name
- **Multi-agent**: Create/switch/inspect agents with different configs
- **Chat**: WebSocket streaming, tool call display, session switching with history
- **Observe Dashboard**: Powered by @berry-agent/observe UI (cost, cache, guard, compaction, inference detail, sessions, agents)
- **Settings**: Provider/agent management UI

## Run

```bash
# Backend
npm install
npm run dev          # http://localhost:3210

# Frontend
cd web && npm install
npm run dev          # http://localhost:3211
```

## Config

`~/.berry-claw/config.json`:

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "sk-...",
      "models": ["claude-sonnet-4-20250514", "claude-haiku-4-20250414"]
    }
  },
  "agents": {
    "default": {
      "model": "claude-sonnet-4-20250514",
      "workspace": "~/.berry-claw/workspace"
    }
  }
}
```

## Tests

```bash
npm test                    # 39 unit tests
npm run test:integration    # 8 integration tests (needs API keys)
```

## Status

Alpha — functional but rough edges. Primary purpose is SDK validation.
