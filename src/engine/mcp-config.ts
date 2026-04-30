// ============================================================
// Berry-Claw — MCP Configuration Loader
// ============================================================
// Loads MCP servers from a 3-layer .mcp.json cascade:
//   global  = ~/.berry-claw/.mcp.json
//   project = <agent.project>/.mcp.json
//   agent   = <agent.workspace>/.mcp.json
//
// Paths are constructed via ConfigManager.*MCPPath() — this module
// never hardcodes the filename. See ./mcp-constants.ts.
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
// replaces wholesale. `shared` is three-state during merge (the
// default is applied *after* the merge, by the layer that actually
// contributed the entry).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MCPTransportConfig } from '@berry-agent/mcp';
import {
  DEFAULT_AGENT_MCP_TEMPLATE,
  defaultMCPPrefix,
} from './mcp-constants.js';

// ============================================================
// Internal normalized shape (what MCPManager consumes)
// ============================================================

/** Layer identity drives defaults: global → shared=true; others → shared=false. */
export type MCPLayer = 'global' | 'project' | 'agent';

export interface MCPServerConfig {
  /** Transport configuration (stdio or http/sse). */
  transport: MCPTransportConfig;
  /** true = shared across agents, false = per-agent instance. */
  shared: boolean;
  /** Prefix added to all tool names (defaults to `${serverName}_`). */
  prefix: string;
  /** Whether this server is enabled (defaults to true). */
  enabled: boolean;
  /**
   * Top-most layer whose entry contributed to the final merged config.
   * UI uses this to show "this server comes from the global/project/agent
   * layer". Merge rule: whichever layer's entry most recently overwrote
   * the name wins (matches "later layers win" for every other field).
   */
  layer: MCPLayer;
}

/**
 * Intermediate representation used during merge. `shared` is optional here
 * so we can distinguish "user didn't write shared" from "user wrote false".
 * After merge, {@link resolveDefaults} collapses `undefined` → layer default.
 */
interface MergingMCPServerConfig {
  transport: MCPTransportConfig;
  shared?: boolean;
  prefix: string;
  enabled: boolean;
  layer: MCPLayer;
}

// ============================================================
// Raw on-disk shape (Claude Code standard + berry extensions)
// ============================================================

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

  const merging: Record<string, MergingMCPServerConfig> = {};
  for (const [name, entry] of Object.entries(raw.mcpServers)) {
    try {
      merging[name] = normalizeEntry(name, entry, layer);
    } catch (err) {
      console.error(
        `[MCP] Skipping invalid server "${name}" in ${filePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return resolveDefaults(merging);
}

/**
 * Load and merge the full 3-layer cascade for a given agent.
 * Order: global → project → agent (later wins field-by-field).
 * The layer default for `shared` is applied *after* the merge, based
 * on whichever layer actually contributed the entry — this preserves
 * user intent when e.g. a `global` entry sets shared=true and a lower
 * layer only tweaks `env`.
 */
export function loadMergedMCPConfig(opts: {
  globalPath: string;
  projectPath?: string;
  agentPath: string;
}): Record<string, MCPServerConfig> {
  const globalLayer = loadRawLayer(opts.globalPath, 'global');
  const projectLayer = opts.projectPath ? loadRawLayer(opts.projectPath, 'project') : {};
  const agentLayer = loadRawLayer(opts.agentPath, 'agent');
  return resolveDefaults(mergeRawLayers([globalLayer, projectLayer, agentLayer]));
}

/**
 * Field-level deep merge of layered MCP configs (public API, pre-resolved).
 * Takes already-resolved {@link MCPServerConfig} layers — this is the shape
 * tests and the old API expected. Merges the three-state internally so the
 * merge bug (defaulted `shared:false` from an upper layer wiping a lower
 * layer's `shared:true`) does not recur.
 */
export function mergeMCPConfigs(
  layers: Array<Record<string, MCPServerConfig>>,
): Record<string, MCPServerConfig> {
  const merging = layers.map(stripDefaults);
  return resolveDefaults(mergeRawLayers(merging));
}

/**
 * Ensure an agent's workspace has a .mcp.json. If missing, writes a
 * default template that registers playwright-mcp as a per-agent server.
 * Idempotent — existing files are left untouched. The path is provided
 * by ConfigManager.agentMCPPath() — callers pass the full path so the
 * filename is not duplicated here.
 */
export function ensureDefaultAgentMCP(mcpPath: string): void {
  if (existsSync(mcpPath)) return;
  if (!existsSync(dirname(mcpPath))) mkdirSync(dirname(mcpPath), { recursive: true });
  writeFileSync(mcpPath, JSON.stringify(DEFAULT_AGENT_MCP_TEMPLATE, null, 2) + '\n', 'utf-8');
}

// ============================================================
// Internals
// ============================================================

function loadRawLayer(
  filePath: string,
  layer: MCPLayer,
): Record<string, MergingMCPServerConfig> {
  if (!existsSync(filePath)) return {};
  let raw: RawMCPJson;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawMCPJson;
  } catch (err) {
    console.error(`[MCP] Failed to parse ${filePath}:`, err instanceof Error ? err.message : err);
    return {};
  }
  if (!raw.mcpServers || typeof raw.mcpServers !== 'object') return {};

  const out: Record<string, MergingMCPServerConfig> = {};
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

function stripDefaults(layer: Record<string, MCPServerConfig>): Record<string, MergingMCPServerConfig> {
  const out: Record<string, MergingMCPServerConfig> = {};
  for (const [name, entry] of Object.entries(layer)) {
    // Treat a resolved `shared` as a user-declared value — this is the
    // safest interpretation for callers passing in already-resolved layers
    // (they've made an explicit choice per entry).
    out[name] = { ...entry };
  }
  return out;
}

function mergeRawLayers(
  layers: Array<Record<string, MergingMCPServerConfig>>,
): Record<string, MergingMCPServerConfig> {
  const out: Record<string, MergingMCPServerConfig> = {};
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

function resolveDefaults(
  merging: Record<string, MergingMCPServerConfig>,
): Record<string, MCPServerConfig> {
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, entry] of Object.entries(merging)) {
    out[name] = {
      transport: entry.transport,
      // If no layer declared `shared`, the top-most contributing layer
      // supplies the default: global → shared=true, project/agent → false.
      shared: entry.shared ?? (entry.layer === 'global'),
      prefix: entry.prefix,
      enabled: entry.enabled,
      layer: entry.layer,
    };
  }
  return out;
}

function normalizeEntry(
  serverName: string,
  entry: RawMCPEntry,
  layer: MCPLayer,
): MergingMCPServerConfig {
  const transport = inferTransport(serverName, entry);
  return {
    transport,
    // Three-state: preserve user intent. Do NOT fill the layer default here —
    // that happens only after all layers have merged, in resolveDefaults.
    shared: typeof entry.shared === 'boolean' ? entry.shared : undefined,
    prefix: entry.prefix ?? defaultMCPPrefix(serverName),
    enabled: entry.enabled ?? true,
    layer,
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

function mergeOne(
  base: MergingMCPServerConfig,
  over: MergingMCPServerConfig,
): MergingMCPServerConfig {
  return {
    transport: mergeTransport(base.transport, over.transport),
    // Three-state merge: a later layer that didn't declare `shared` keeps
    // whatever the base had. This is the whole point of the refactor —
    // without this, project/agent layers would silently wipe a global
    // shared=true because normalizeEntry used to fill shared=false.
    shared: over.shared ?? base.shared,
    // `prefix` and `enabled` always have a value in merging form (either
    // the user's or the per-entry default); last writer wins.
    prefix: over.prefix,
    enabled: over.enabled,
    // Attribute to whichever layer last contributed.
    layer: over.layer,
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
