// ============================================================
// Berry-Claw — MCP-related constants (single source of truth)
// ============================================================
// Every piece of code that talks about the on-disk .mcp.json layer
// MUST reference these constants. Do not inline the filename or the
// default template — drift here causes silent breakage (e.g. one site
// writing `.mcp.json` and another looking for `mcp.json`).

/** File name of the on-disk MCP layer config (same across all 3 layers). */
export const MCP_CONFIG_FILENAME = '.mcp.json' as const;

/**
 * Default per-agent MCP template seeded on first agent init when the
 * agent workspace has no `.mcp.json`. Kept in `raw` shape (what users
 * write in the file) rather than the normalized form, so the template
 * round-trips through `loadMCPLayer` exactly like a hand-written file.
 */
export const DEFAULT_AGENT_MCP_TEMPLATE = {
  mcpServers: {
    playwright: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--headless'],
    },
  },
} as const;

/**
 * Separator appended after the server name when auto-generating a
 * default tool prefix (`${serverName}${MCP_DEFAULT_PREFIX_SEPARATOR}`).
 * Exposed so tests and UI can reconstruct / decode the convention.
 */
export const MCP_DEFAULT_PREFIX_SEPARATOR = '_' as const;

/** Compute the default tool-name prefix for a given MCP server. */
export function defaultMCPPrefix(serverName: string): string {
  return `${serverName}${MCP_DEFAULT_PREFIX_SEPARATOR}`;
}
