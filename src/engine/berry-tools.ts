// ============================================================
// Berry-Claw — System Management Tools (berry_*)
// ============================================================
// Structured tools that let agents introspect and control the
// berry-claw server they run in — without resorting to raw
// shell commands that could kill their own process.

import type { ToolRegistration } from '@berry-agent/core';
import { ToolGroup } from '@berry-agent/core';

/**
 * Dependencies that berry tools need from AgentManager.
 * Defined as an interface to avoid circular imports — the
 * manager constructs a deps object with bound methods in initAgent().
 */
export interface BerryToolDeps {
  // Read-only status
  getActiveAgentId: () => string;
  getAgentStatus: (id: string) => { status: string; detail?: string } | null;
  currentModel: () => { model: string; providerName: string; type: string } | null;
  listAgents: () => Array<{ id: string; entry: { name: string; model: string } }>;
  getTiers: () => Record<string, string | undefined>;

  // Config read
  listProviderInstances: () => Array<{
    id: string;
    entry: { presetId: string; type?: string; label?: string; baseUrl?: string; apiKey: string };
  }>;
  listModels: () => Array<{
    id: string;
    entry: { label?: string; providers: Array<{ providerId: string; remoteModelId?: string }> };
  }>;
  getAgent: (id: string) => {
    name: string;
    model: string;
    workspace?: string;
    project?: string;
    tools?: string[];
    disabledTools?: string[];
  } | null;

  // Config write
  setModel: (id: string, entry: Record<string, unknown>) => void;
  setTier: (tier: string, modelId: string | null) => void;
  reloadAgent: (id: string) => void;

  // Server lifecycle
  scheduleRestart: (reason?: string) => void;

  // Environment
  port: number;
  startTime: number;
}

/**
 * Mask API keys for display: show 6-char prefix + bullets + last 3 chars.
 * Keys <= 8 chars are fully bulleted to avoid leaking short keys.
 */
function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '\u2022'.repeat(key.length);
  return key.slice(0, 6) + '\u2022'.repeat(8) + key.slice(-3);
}

/**
 * Create the berry_* system management tools.
 * Called once per agent in initAgent(), after the Agent instance is built.
 */
export function createBerryTools(deps: BerryToolDeps): ToolRegistration[] {
  return [
    // ── berry_status ──────────────────────────────────────────────
    {
      definition: {
        name: 'berry_status',
        group: ToolGroup.System,
        description:
          'Get berry-claw server status: port, uptime, active agent, current model, ' +
          'tier configuration, and all agent states. Read-only, always safe to call.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      execute: async () => {
        const uptime = Math.floor((Date.now() - deps.startTime) / 1000);
        const agents = deps.listAgents().map(({ id, entry }) => ({
          id,
          name: entry.name,
          model: entry.model,
          status: deps.getAgentStatus(id)?.status ?? 'idle',
        }));

        const result = {
          port: deps.port,
          uptimeSeconds: uptime,
          activeAgent: deps.getActiveAgentId(),
          currentModel: deps.currentModel(),
          tiers: deps.getTiers(),
          agents,
        };

        return { content: JSON.stringify(result, null, 2) };
      },
    },

    // ── berry_restart ─────────────────────────────────────────────
    {
      definition: {
        name: 'berry_restart',
        group: ToolGroup.System,
        description:
          'Restart the berry-claw server gracefully. The current process exits after ' +
          'a 500ms delay (your turn will complete first). A process manager (pm2, systemd, etc.) ' +
          'should restart the process automatically. Use after code changes or config edits ' +
          'that require a full restart.',
        inputSchema: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Optional reason for the restart (logged to console).',
            },
          },
        },
      },
      execute: async (input) => {
        const reason = (input.reason as string | undefined)?.trim() || undefined;
        deps.scheduleRestart(reason);
        return {
          content:
            'Restart scheduled. Server will exit in 500ms. ' +
            'Ensure a process manager (pm2, systemd, berry-claw CLI) restarts the process. ' +
            'Your current turn will complete before shutdown.',
        };
      },
    },

    // ── berry_config ─────────────────────────────────────────────
    {
      definition: {
        name: 'berry_config',
        group: ToolGroup.System,
        description:
          'Read or modify berry-claw configuration. Use action "get" to inspect providers, ' +
          'models, tiers, or agents. Use action "set" to modify model bindings or tier mappings. ' +
          'API keys in provider output are masked for safety.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['get', 'set'],
              description: '"get" to read config, "set" to modify it.',
            },
            scope: {
              type: 'string',
              enum: ['provider', 'model', 'tier', 'agent'],
              description: 'Config layer to access.',
            },
            key: {
              type: 'string',
              description: 'Specific item id. Omit to list all items in the scope.',
            },
            value: {
              description: 'For "set" action: the new value (object or string depending on scope).',
            },
          },
          required: ['action', 'scope'],
        },
      },
      execute: async (input) => {
        const action = input.action as string;
        const scope = input.scope as string;
        const key = input.key as string | undefined;
        const value = input.value;

        if (action === 'get') {
          return handleConfigGet(deps, scope, key);
        }
        if (action === 'set') {
          return handleConfigSet(deps, scope, key, value);
        }
        return { content: `Unknown action "${action}". Use "get" or "set".`, isError: true };
      },
    },
  ];
}

// ── Config Get Handler ──────────────────────────────────────────

function handleConfigGet(
  deps: BerryToolDeps,
  scope: string,
  key: string | undefined,
): { content: string; isError?: boolean } {
  switch (scope) {
    case 'provider': {
      const instances = deps.listProviderInstances();
      if (key) {
        const found = instances.find((p) => p.id === key);
        if (!found) return { content: `Provider "${key}" not found.`, isError: true };
        return { content: JSON.stringify(maskProvider(found), null, 2) };
      }
      return { content: JSON.stringify(instances.map(maskProvider), null, 2) };
    }
    case 'model': {
      const models = deps.listModels();
      if (key) {
        const found = models.find((m) => m.id === key);
        if (!found) return { content: `Model "${key}" not found.`, isError: true };
        return { content: JSON.stringify(found, null, 2) };
      }
      return { content: JSON.stringify(models, null, 2) };
    }
    case 'tier': {
      const tiers = deps.getTiers();
      if (key) {
        const modelId = tiers[key as keyof typeof tiers];
        if (modelId === undefined) return { content: `Tier "${key}" not found.`, isError: true };
        return { content: JSON.stringify({ [key]: modelId }, null, 2) };
      }
      return { content: JSON.stringify(tiers, null, 2) };
    }
    case 'agent': {
      const agents = deps.listAgents();
      if (key) {
        const found = agents.find((a) => a.id === key);
        if (!found) return { content: `Agent "${key}" not found.`, isError: true };
        return { content: JSON.stringify(found, null, 2) };
      }
      return { content: JSON.stringify(agents, null, 2) };
    }
    default:
      return { content: `Unknown scope "${scope}". Use provider, model, tier, or agent.`, isError: true };
  }
}

// ── Config Set Handler ──────────────────────────────────────────

function handleConfigSet(
  deps: BerryToolDeps,
  scope: string,
  key: string | undefined,
  value: unknown,
): { content: string; isError?: boolean } {
  if (!key) {
    return { content: `"set" requires a "key" to identify the target.`, isError: true };
  }

  switch (scope) {
    case 'model': {
      if (!value || typeof value !== 'object') {
        return { content: `"set model" requires a "value" object with { id, providers }.` , isError: true };
      }
      deps.setModel(key, value as Record<string, unknown>);
      try { deps.reloadAgent(key); } catch { /* agent may not be running */ }
      return { content: `Model "${key}" updated.` };
    }
    case 'tier': {
      // value can be a model id string or null to remove the tier
      const modelId = value === null || value === 'null' ? null : String(value);
      deps.setTier(key, modelId);
      return { content: `Tier "${key}" set to ${modelId ?? '(removed)'}.` };
    }
    case 'provider': {
      return { content: `"set provider" is not yet supported via berry_config. Use the web UI or edit config.json directly.`, isError: true };
    }
    case 'agent': {
      return { content: `"set agent" is not yet supported via berry_config. Use the web UI or berry_config get agent <id> to inspect.`, isError: true };
    }
    default:
      return { content: `Unknown scope "${scope}". Use model, tier, provider, or agent.`, isError: true };
  }
}

// ── Helpers ────────────────────────────────────────────────────

function maskProvider(p: { id: string; entry: { presetId: string; type?: string; label?: string; baseUrl?: string; apiKey: string } }) {
  return {
    id: p.id,
    presetId: p.entry.presetId,
    type: p.entry.type,
    label: p.entry.label,
    baseUrl: p.entry.baseUrl,
    apiKey: maskKey(p.entry.apiKey),
  };
}