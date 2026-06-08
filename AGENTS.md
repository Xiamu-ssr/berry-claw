# berry-claw — AGENTS.md

> berry-claw is the first **product** on the berry agent platform. This file
> is its design north-star (it supersedes the older `AGENTS.HTML`, which
> described the legacy "Claw is Host" model). The platform itself (a8s + SDK)
> is documented in `berry-agent-sdk/AGENTS.HTML` — read that first for 4+1,
> the cluster, and the a8s API surface.

## What berry-claw is

**An operating console for agents that live on a8s — plus the user's local
"hand".** It is NOT an agent engine, and it does NOT own agent state.

a8s owns the entire agent platform: 4+1 (session/hand/sandbox/orchestration),
the skill market, the Hand registry, the collaboration substrate, observe /
billing / logs, and product-scoped tenancy. berry-claw **connects directly to
a8s** through `@berry-agent/client` and gives a human a nice way to create,
configure, talk to, and observe agents.

The one principle that shapes everything: **berry-claw never translates agent
semantics.** The moment a backend re-encodes agents/sessions/skills on their
way through, it becomes a redundant layer and a second source of truth. So
agent semantics stay in a8s and the product talks to a8s directly.

## Shape

```
berry-claw front-end (client)        operating console + local Hand host
  - create / configure agents        (Electron: runs local stdio MCP,
  - chat (streaming)                  registers local files/shell/MCP as
  - single / team / cluster           reverse Hands for cloud agents)
  - observe / sessions
        │
        │ @berry-agent/client (HTTP + WS, product-scoped token)
        ▼
       a8s                            the whole agent platform (雪山引擎)
```

- **Front-end (client)** is where the value is: the console **and** the
  user's local Hand host (a reverse-Hand provider — local MCP/files/shell
  exposed to cloud agents; see SDK memory `client_as_reverse_hand_host`).
- **Back-end (BFF), if any**, is a thin shell for **non-agent business only**
  (future features unrelated to agent semantics: dashboards, billing pages, a
  product auth proxy). It must not carry an agent engine, hosts, a runtime,
  or any agent config state. The legacy backend (AgentManager + 8 hosts +
  in-process Worker + mcpManager + agent/model/provider config store) is
  being deleted.

## Three agent forms (all via a8s collaboration primitives)

Single agent, **team** (with hierarchy), and **agents cluster** (flat, no
leader, larger). All three are the same thing: a set of agents on a8s, each
carrying a different collaboration skill. claw creates the agents and mounts
`team` or `cluster` skills; the spawn/wake/message/peer primitives are a8s's.
No team engine in claw.

## Agent configuration (what a user edits)

Configuring an agent = editing its **a8s spec / home**, not local product
config:

- **Brain**: pick a model (a8s models-template / tiers).
- **Hands**: pick which Hands the agent mounts — built-in `workspace`/`web`
  (`labels.hands`), machine Hands (`labels.machines`), or from the **Hand
  market**. A Hand is one bundle of tools/MCP bound to one execution env: you
  select a Hand, you don't edit its env. Adding a capability is normally
  adding an MCP (JSON); a genuinely new tool means writing an MCP server.
- **Skills**: mount skills — system skills by name, from the **skill market /
  ClawHub** (which a8s fronts), or agent-authored. Skills are knowledge files
  in the agent home; a8s proxies install/remove.
- **System prompt**: only the **variable** parts are editable — the agent's
  `AGENTS.md` and the project `AGENTS.md` (via a8s home read/write). The
  **fixed** parts (env context, skill index) are read-only; the SDK composes
  them.

## Hand / capability ownership (do not get this wrong)

- "Which Hands exist on a host" is decided **by that host** (a Mac reads its
  own `.mcp.json`; a machine connector exposes its own exec). a8s is
  registered *to*; it never reaches into a host.
- "Which Hands an agent mounts" is **a8s assembly**; claw forwards the choice.
- A host exposes Hands by running a host process: the GUI client (a person's
  Mac) or a `berry-machine` connector (headless Linux). exec inherits the
  identity of whoever started that process — that is the security boundary.
- MCP is **not** a BFF concern. It belongs to the Hand host.

## Platform strategy (Mac = Electron, mobile = no-Chromium shell)

One React core (`packages/client`), two shells:

- **Mac / desktop = Electron** (`packages/desktop`). Electron bundles Chromium,
  and that is **on purpose**: the product's headline feature is a codex-style
  **in-app browser you can 圈画 (annotate)** — open any page, drag-select a
  region, attach a note, and hand that to the agent. That needs a real,
  controllable browser engine (`WebContentsView` + `capturePage()` + script
  injection), which only Chromium-in-Electron gives cleanly. Electron's size /
  power cost is accepted on the desktop in exchange for this. You cannot strip
  Chromium out of Electron — it is the engine.
- **Mobile = a no-Chromium shell** (`packages/mobile`, Capacitor → system
  WebView). Phones don't carry a second browser engine, so the bundle stays
  small and power-cheap. The trade: **圈画 is a Mac-only module** — mobile
  drops it. Mobile is the conversation / cluster-monitoring surface, not the
  annotation surface.
- **The split lives in the shell, not the core.** The React app is shared; the
  browser-surface capability is feature-detected via `window.berryDesktopBrowser`
  (BrowserRail already renders a graceful "desktop-only" fallback when absent).
  Keep圈画 logic behind that boundary so a no-Chromium build simply doesn't
  mount it — never `#ifdef` Chromium into the shared core.

The圈画 geometry/url math is pure and unit-tested in
`client/src/components/workspace/browserAnnotation.ts`; the DOM/Electron parts
(capture, canvas crop) stay in `BrowserRail.tsx` / `desktop/src/browser-surface.cjs`.

## Hard rules for this codebase

- No agent engine, no hosts, no in-process Worker, no agent/model/provider
  config store in the backend. If you're re-implementing something a8s owns,
  stop and call a8s instead.
- One source of truth: agent data comes from a8s. Don't cache a parallel copy.
- The front-end is the product; keep any backend boring.
