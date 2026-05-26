// ============================================================
// Berry-Claw — MCP Configuration Loader (thin wrapper)
// ============================================================
// The 3-layer cascade mechanics — file parsing, transport
// inference, field-level deep merge, three-state `shared`
// handling — live in `@berry-agent/mcp`. This file owns only
// the berry-claw-specific semantics:
//
//   global  = ~/.berry-claw/.mcp.json        (sharedDefault=true)
//   project = <agent.project>/.mcp.json      (sharedDefault=false)
//   agent   = <agent.workspace>/.mcp.json    (sharedDefault=false)
//
// Paths come from ConfigManager.*MCPPath() — this module never
// hardcodes the filename.

import {
  createNodePackageBinResolver,
  loadMCPLayer as sdkLoadMCPLayer,
  loadMergedMCPConfig as sdkLoadMergedMCPConfig,
  mergeMCPConfigs as sdkMergeMCPConfigs,
  normalizeDefaultMCPServerConfig,
  type MCPServerConfig as SdkMCPServerConfig,
} from '@berry-agent/mcp';

const packageBinResolver = createNodePackageBinResolver(import.meta.url);

/** Layer identity drives defaults: global → shared=true; others → shared=false. */
export type MCPLayer = 'global' | 'project' | 'agent';

/**
 * berry-claw's narrowed view of the SDK's {@link SdkMCPServerConfig} —
 * `layer` is restricted to the 3-value union so call sites get exhaustive
 * checks via TS discriminated unions.
 */
export interface MCPServerConfig extends Omit<SdkMCPServerConfig, 'layer'> {
  layer: MCPLayer;
}

/** Per-layer `shared` default: only 'global' entries default to shared=true. */
function sharedDefaultFor(layer: MCPLayer): boolean {
  return layer === 'global';
}

/**
 * Load one layer of MCP config from disk. Returns empty map when the
 * file is missing.
 */
export function loadMCPLayer(
  filePath: string,
  layer: MCPLayer,
): Record<string, MCPServerConfig> {
  return narrowLayer(sdkLoadMCPLayer(filePath, layer, sharedDefaultFor(layer)), layer);
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
  const layers = [
    { filePath: opts.globalPath, label: 'global', sharedDefault: true },
    ...(opts.projectPath
      ? [{ filePath: opts.projectPath, label: 'project', sharedDefault: false }]
      : []),
    { filePath: opts.agentPath, label: 'agent', sharedDefault: false },
  ];
  return narrowRecord(sdkLoadMergedMCPConfig({ layers }));
}

/**
 * Field-level deep merge of pre-resolved {@link MCPServerConfig} layers.
 * Preserves the three-state `shared` / `prefix` semantics.
 */
export function mergeMCPConfigs(
  layers: Array<Record<string, MCPServerConfig>>,
): Record<string, MCPServerConfig> {
  return narrowRecord(sdkMergeMCPConfigs(layers));
}

// ============================================================
// Label → union narrowing
// ============================================================
// The SDK types `layer` as an open string — berry-claw narrows it
// back to the MCPLayer union so downstream `switch (s.layer)` etc.
// still get exhaustive type checks. The runtime values are already
// constrained because we only ever pass 'global' / 'project' / 'agent'
// into the SDK; the cast is therefore safe.

function narrowLayer(
  record: Record<string, SdkMCPServerConfig>,
  expected: MCPLayer,
): Record<string, MCPServerConfig> {
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, entry] of Object.entries(record)) {
    out[name] = normalizeBuiltInServer({ ...entry, layer: (entry.layer as MCPLayer) ?? expected });
  }
  return out;
}

function narrowRecord(
  record: Record<string, SdkMCPServerConfig>,
): Record<string, MCPServerConfig> {
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, entry] of Object.entries(record)) {
    out[name] = normalizeBuiltInServer({ ...entry, layer: entry.layer as MCPLayer });
  }
  return out;
}

function normalizeBuiltInServer(entry: MCPServerConfig): MCPServerConfig {
  return normalizeDefaultMCPServerConfig(entry, {
    resolvePackageBin: packageBinResolver,
  }) as MCPServerConfig;
}
