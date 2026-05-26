// ============================================================
// Berry-Claw — Read-only Host Introspection Tools
// ============================================================
// These tools are mounted as a host hand so an agent can inspect the product
// shell it is running inside. Mutating product config, model bindings, tiers,
// or process lifecycle belongs to Claw's host control plane (REST/UI), not to
// normal agent hands.

import type { ToolRegistration } from '@berry-agent/core';
import { ToolGroup } from '@berry-agent/core';

export interface BerryToolDeps {
  getActiveAgentId: () => string;
  getAgentStatus: (id: string) => { status: string; detail?: string } | null;
  currentModel: () => { model: string; providerName: string; type: string } | null;
  listAgents: () => Array<{ id: string; entry: { name: string; model: string } }>;
  getTiers: () => Record<string, string | undefined>;
  listProviderInstances: () => Array<{
    id: string;
    entry: { presetId: string; type?: string; label?: string; baseUrl?: string; apiKey: string };
  }>;
  listModels: () => Array<{
    id: string;
    entry: { label?: string; contextWindow?: number; providers: Array<{ providerId: string; remoteModelId?: string }> };
  }>;
  getAgent: (id: string) => {
    name: string;
    model: string;
    workspace?: string;
    project?: string;
    tools?: string[];
    disabledTools?: string[];
  } | null;
  port: number;
  startTime: number;
}

export function createBerryTools(deps: BerryToolDeps): ToolRegistration[] {
  return [
    {
      definition: {
        name: 'berry_status',
        group: ToolGroup.System,
        description:
          'Read berry-claw host status: server port, uptime, active agent, current model, tier bindings, and agent states.',
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

        return {
          content: JSON.stringify({
            port: deps.port,
            uptimeSeconds: uptime,
            activeAgent: deps.getActiveAgentId(),
            currentModel: deps.currentModel(),
            tiers: deps.getTiers(),
            agents,
          }, null, 2),
        };
      },
    },
    {
      definition: {
        name: 'berry_config_get',
        group: ToolGroup.System,
        description:
          'Read berry-claw product configuration for providers, models, tiers, or agents. API keys are masked. This tool is read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['provider', 'model', 'tier', 'agent'],
              description: 'Config layer to inspect.',
            },
            key: {
              type: 'string',
              description: 'Specific item id. Omit to list all items in the scope.',
            },
          },
          required: ['scope'],
        },
      },
      execute: async (input) => handleConfigGet(deps, input.scope as string, input.key as string | undefined),
    },
  ];
}

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
      if (key) {
        const found = deps.getAgent(key);
        if (!found) return { content: `Agent "${key}" not found.`, isError: true };
        return { content: JSON.stringify({ id: key, entry: found, status: deps.getAgentStatus(key) }, null, 2) };
      }
      return { content: JSON.stringify(deps.listAgents().map(({ id, entry }) => ({
        id,
        entry,
        status: deps.getAgentStatus(id),
      })), null, 2) };
    }
    default:
      return { content: `Unknown scope "${scope}". Use provider, model, tier, or agent.`, isError: true };
  }
}

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

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}${'*'.repeat(8)}${key.slice(-3)}`;
}
