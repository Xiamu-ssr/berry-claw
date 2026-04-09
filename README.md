# berry-claw 🐾

An AI agent product built on [berry-agent-sdk](https://github.com/Xiamu-ssr/berry-agent-sdk) — validating the SDK by eating our own dog food.

## Purpose

This is the **first consumer** of `@berry-agent/core` and `@berry-agent/safe`. The goal is to:

1. Prove the SDK works end-to-end in a real product
2. Expose API design issues that only surface under real usage
3. Feed improvements back to the SDK

## Architecture

```
src/
  agent/     — Agent configuration, system prompts, skill loading
  server/    — HTTP/WebSocket server (API layer)
  tools/     — Custom tools (file ops, shell, search, etc.)
  main.ts    — Entry point
```

**Three-layer design:**
- **Agent layer**: Pure `@berry-agent/core` usage — no HTTP, no UI
- **Server layer**: HTTP/WS API that wraps the agent for external consumers
- **Tools layer**: Tool implementations that the agent can call

## Stack

- `@berry-agent/core` — Agent loop, providers, compaction
- `@berry-agent/safe` — Guards, PI probe
- TypeScript + tsx (dev runtime)

## Status

🚧 Under construction — SDK validation phase.
