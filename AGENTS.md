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

## Hard rules for this codebase

- No agent engine, no hosts, no in-process Worker, no agent/model/provider
  config store in the backend. If you're re-implementing something a8s owns,
  stop and call a8s instead.
- One source of truth: agent data comes from a8s. Don't cache a parallel copy.
- The front-end is the product; keep any backend boring.
