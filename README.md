# berry-claw 🐾

A local-first AI agent product built on [berry-agent-sdk](https://github.com/Xiamu-ssr/berry-agent-sdk) — multi-provider, multi-agent, with a built-in observability dashboard.

> eating our own dog food

---

## Install

```bash
npm install -g berry-claw
```

Or one-shot via `npx`:

```bash
npx berry-claw
```

Requires **Node.js ≥ 20**.

---

## Quick start

```bash
# 1. First-time setup (creates ~/.berry-claw/, asks about optional deps)
berry-claw setup

# 2. Launch server + Web UI
berry-claw

# 3. Open http://localhost:3210 and add a provider + agent in Settings.
```

That's it. No config file to hand-edit; the Web UI walks you through it.

---

## CLI

| Command | What it does |
|---|---|
| `berry-claw` | Start server + Web UI (default) |
| `berry-claw start` | Same as above (explicit) |
| `berry-claw setup` | First-time setup wizard |
| `berry-claw doctor` | Environment self-check |
| `berry-claw install browser` | Install the browser runtime for the `browser` tool |
| `berry-claw version` | Print version |
| `berry-claw help` | Show help |

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3210` | HTTP port |
| `BERRY_CLAW_HOME` | `~/.berry-claw` | Data directory (agents, sessions, observe DB, config) |

---

## What's inside

- **Multi-provider**: Anthropic / OpenAI-compatible. Route requests by model name.
- **Multi-agent**: Create/switch/inspect agents with their own tools, skills, and workspace.
- **Chat UI**: Streaming WebSocket, tool-call view, session history.
- **Observability**: Cost, cache hit-rate, guard decisions, compaction timeline, turn-level inference detail.
- **Settings UI**: Provider + agent + credentials management.

---

## Optional capabilities

Some features need extra runtime assets that aren't shipped by default:

| Capability | Install | Why it's optional |
|---|---|---|
| Browser tool | `berry-claw install browser` | Downloads Chromium (~150 MB). Only needed if you let agents drive real pages. |

`berry-claw doctor` will tell you what's missing.

---

## SDK integration

berry-claw is a thin product shell over [berry-agent-sdk](https://github.com/Xiamu-ssr/berry-agent-sdk):

| SDK Package | Usage |
|---|---|
| `@berry-agent/core` | Agent loop, sessions, providers, retry/timeout, compaction |
| `@berry-agent/tools-common` | All built-in tools (read/write/edit/shell/search/web/browser) |
| `@berry-agent/observe` | `createObserveRouter()` — drops in the whole observe REST API |
| `@berry-agent/safe` | `compositeGuard(directoryScope, denyList)` for tool-guard policy |

---

## Data layout

```
~/.berry-claw/
├── config.json          # providers + agents + credentials (mode 0600)
├── observe.db           # SQLite: cost, cache, guard, turns, inferences
├── agents/
│   └── <agent-id>/      # each agent's isolated workspace
└── sessions/
    └── <agent-id>/*.json
```

---

## Develop

From a clone of the repo:

```bash
npm install
npm run dev               # backend (3210) + Vite dev server (3211)
npm test                  # unit tests
```

Run the built CLI against the local code:

```bash
npm run build
node dist/cli.js doctor
```

---

## Status

Alpha. Functional but rough edges. Primary purpose right now is SDK validation.
