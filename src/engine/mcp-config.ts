// ============================================================
// Berry-Claw — MCP Configuration Loader
// ============================================================
// Loads MCP servers from a 3-layer .mcp.json cascade:
//   global  = ~/.berry-claw/.mcp.json
//   project = <agent.project>/.mcp.json
//   agent   = <agent.workspace>/.mcp.json
//
// The on-disk schema follows Claude Code / Cursor standard: a flat
// mcpServers map whose entries carry `command`/`args`/`env` (stdio)
// or `type`/`url`/`headers` (sse / http). berry-claw-specific
// metadata (`shared`, `prefix`, `enabled`) is layered on as optional
// fields — a vanilla Claude Code config parses without edits.
//
// Merge semantics: field-level deep merge across layers, later
// layers override earlier ones. `env` and `headers` merge at key
// level so a lower layer can inject extras. `args` is a list and
// replaces wholesale.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MCPTransportConfig } from '@berry-agent/mcp';

// ============================================================
// Internal normalized shape (what MCPManager consumes)
// ============================================================

export interface MCPServerConfig {
  /** Transport configuration (stdio or http/sse). */
  transport: MCPTransportConfig;
  /** true = shared across agents, false = per-agent instance. */
  shared: boolean;
  /** Prefix added to all tool names (defaults to `${serverName}_`). */
  prefix?: string;
  /** Whether this server is enabled (defaults to true). */
  enabled?: boolean;
}

// ============================================================
// Raw on-disk shape (Claude Code standard + berry extensions)
// ============================================================

/** Layer identity drives defaults: global → shared=true; others → shared=false. */
export type MCPLayer = 'global' | 'project' | 'agent';

/** Raw entry as written by the user in .mcp.json. */
interface RawMCPEntry {
  // stdio fields
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  // sse / http fields
  type?: string; // 'stdio' | 'sse' | 'http' | 'streamable_http' — case-insensitive
  url?: string;
  headers?: Record<string, string>;

  // berry-claw extensions
  shared?: boolean;
  prefix?: string;
  enabled?: boolean;
}

interface RawMCPJson {
  mcpServers?: Record<string, RawMCPEntry>;
}

// ============================================================
// Public API
// ============================================================

/**
 * Load one layer of MCP config from disk. Returns empty map when the
 * file is missing — callers build the cascade by concatenating layers.
 */
export function loadMCPLayer(
  filePath: string,
  layer: MCPLayer,
): Record<string, MCPServerConfig> {
  if (!existsSync(filePath)) return {};
  let raw: RawMCPJson;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawMCPJson;
  } catch (err) {
    console.error(`[MCP] Failed to parse ${filePath}:`, err instanceof Error ? err.message : err);
    return {};
  }
  if (!raw.mcpServers || typeof raw.mcpServers !== 'object') return {};

  const out: Record<string, MCPServerConfig> = {};
  for (const [name, entry] of Object.entries(raw.mcpServers)) {
    try {
      out[name] = normalizeEntry(name, entry, layer);
    } catch (err) {
      console.error(
        `[MCP] Skipping invalid server "${name}" in ${filePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return out;
}

/**
 * Load and merge the full 3-layer cascade for a given agent.
 * Order: global → project → agent (later wins field-by-field).
 */
export function loadMergedMCPConfig(opts: {
  globalPath: string;
  projectPath?: string;
  agentPath: string;
}): Record<string, MCPServerConfig> {
  const globalLayer = loadMCPLayer(opts.globalPath, 'global');
  const projectLayer = opts.projectPath ? loadMCPLayer(opts.projectPath, 'project') : {};
  const agentLayer = loadMCPLayer(opts.agentPath, 'agent');
  return mergeMCPConfigs([globalLayer, projectLayer, agentLayer]);
}

/**
 * Field-level deep merge of layered MCP configs. Same-name servers
 * have their fields merged:
 *   - transport.env / transport.headers: key-level merge
 *   - transport.args: wholesale replace (lists aren't field-mergeable)
 *   - transport.command / url / type / cwd: overwrite
 *   - shared / prefix / enabled: overwrite
 */
export function mergeMCPConfigs(
  layers: Array<Record<string, MCPServerConfig>>,
): Record<string, MCPServerConfig> {
  const out: Record<string, MCPServerConfig> = {};
  for (const layer of layers) {
    for (const [name, incoming] of Object.entries(layer)) {
      const existing = out[name];
      if (!existing) {
        out[name] = structuredClone(incoming);
      } else {
        out[name] = mergeOne(existing, incoming);
      }
    }
  }
  return out;
}

/**
 * Ensure an agent's workspace has a .mcp.json. If missing, writes a
 * default template that registers playwright-mcp as a per-agent server.
 * Idempotent — existing files are left untouched.
 */
export function ensureDefaultAgentMCP(workspaceDir: string): void {
  const path = join(workspaceDir, '.mcp.json');
  if (existsSync(path)) return;

  const template: RawMCPJson = {
    mcpServers: {
      playwright: {
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest', '--headless'],
      },
    },
  };

  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(template, null, 2) + '\n', 'utf-8');
}

// ============================================================
// Internals
// ============================================================

function normalizeEntry(
  serverName: string,
  entry: RawMCPEntry,
  layer: MCPLayer,
): MCPServerConfig {
  const transport = inferTransport(serverName, entry);

  // shared default depends on which layer the entry came from.
  // Global-layer entries default to shared=true (global servers are the
  // common case at that scope). Project and agent layers default to
  // shared=false (scoped to the agent that asked for them).
  const defaultShared = layer === 'global';
  const shared = typeof entry.shared === 'boolean' ? entry.shared : defaultShared;

  return {
    transport,
    shared,
    prefix: entry.prefix ?? `${serverName}_`,
    enabled: entry.enabled ?? true,
  };
}

function inferTransport(serverName: string, entry: RawMCPEntry): MCPTransportConfig {
  const type = entry.type?.toLowerCase();

  // Explicit http / sse / streamable_http
  if (type === 'http' || type === 'streamable_http' || type === 'sse') {
    if (!entry.url) {
      throw new Error(`server "${serverName}" with type="${entry.type}" requires "url"`);
    }
    // Our MCP package currently models both streamable_http and http
    // under a single 'http' transport. SSE is not yet supported by the
    // SDK; warn and map to http so the manifest parses without crashing.
    // (SDK Phase 3 will add SSE.)
    if (type === 'sse') {
      console.warn(`[MCP] server "${serverName}" requested SSE transport; SDK support pending, falling back to http.`);
    }
    return {
      type: 'http',
      url: entry.url,
      headers: entry.headers,
    };
  }

  // Implicit stdio: either type === 'stdio' or no type + command present
  if (type === 'stdio' || (!type && entry.command)) {
    if (!entry.command) {
      throw new Error(`server "${serverName}" with stdio transport requires "command"`);
    }
    return {
      type: 'stdio',
      command: entry.command,
      args: entry.args,
      env: entry.env,
      cwd: entry.cwd,
    };
  }

  throw new Error(
    `server "${serverName}": cannot infer transport (need either "command" for stdio or "type" + "url" for http/sse)`,
  );
}

function mergeOne(base: MCPServerConfig, over: MCPServerConfig): MCPServerConfig {
  return {
    transport: mergeTransport(base.transport, over.transport),
    shared: over.shared,
    prefix: over.prefix ?? base.prefix,
    enabled: over.enabled ?? base.enabled,
  };
}

function mergeTransport(
  base: MCPTransportConfig,
  over: MCPTransportConfig,
): MCPTransportConfig {
  // If transport kind changes across layers, the override wins wholesale —
  // it's nonsensical to merge stdio fields with http fields.
  if (base.type !== over.type) return structuredClone(over);

  if (base.type === 'stdio' && over.type === 'stdio') {
    return {
      type: 'stdio',
      command: over.command ?? base.command,
      args: over.args ?? base.args,
      env: mergeRecords(base.env, over.env),
      cwd: over.cwd ?? base.cwd,
    };
  }

  if (base.type === 'http' && over.type === 'http') {
    return {
      type: 'http',
      url: over.url ?? base.url,
      headers: mergeRecords(base.headers, over.headers),
    };
  }

  // Fallback (shouldn't happen given the guard above).
  return structuredClone(over);
}

function mergeRecords(
  base: Record<string, string> | undefined,
  over: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !over) return undefined;
  return { ...(base ?? {}), ...(over ?? {}) };
}
