/**
 * a8s agent lifecycle + introspection for the Agents page.
 *
 * berry-claw holds no agent config — create/delete and the model catalog all
 * resolve through @berry-agent/client against the control plane. The shapes
 * returned here match what AgentsPage already consumes (ModelCatalogItem[],
 * InspectRuntime) so the page is a body-swap from the torn-down /api/* routes.
 */
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import type { InspectRuntime, ToolDef } from '../components/agents/types';
import { modelFamily } from '../utils/format';
import { a8sClient } from './client';

export interface CreateAgentInput {
  agentId: string;
  name: string;
  model: string;
  classifierModel?: string;
  reasoningEffort?: string;
  project?: string;
}

/**
 * Create (or re-create) an agent on a8s. berry-claw is the owning product, so
 * we stamp labels.owner; the worker resolves `workspace: agentId` to the home
 * dir. Name is carried as a label since the wire spec has no display-name slot.
 */
export async function createAgent(input: CreateAgentInput): Promise<{ agentId: string; workerId: string }> {
  const client = await a8sClient();
  const labels: Record<string, string> = { owner: 'berry-claw' };
  if (input.name) labels.name = input.name;
  if (input.project) labels.project = input.project;
  const res = await client.createAgent({
    spec: {
      agentId: input.agentId,
      workspace: input.agentId,
      model: input.model,
      ...(input.classifierModel ? { classifierModel: input.classifierModel } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      labels,
    },
  });
  return { agentId: res.agentId, workerId: res.workerId };
}

export async function deleteAgent(agentId: string): Promise<void> {
  const client = await a8sClient();
  await client.deleteAgent(agentId);
}

/**
 * Live-patch an agent's spec (model / classifierModel / reasoningEffort /
 * toolDenylist / hands). Only those fields exist on the wire; the module
 * panel may hand us extras (e.g. safetyLevel) which a8s doesn't accept yet —
 * we drop them so a not-yet-ported control can't 400 the whole patch.
 */
const PATCHABLE_SPEC_FIELDS = ['model', 'classifierModel', 'reasoningEffort', 'toolDenylist', 'hands'] as const;
export async function patchAgentSpec(agentId: string, patch: Record<string, unknown>): Promise<boolean> {
  const allowed: Record<string, unknown> = {};
  for (const key of PATCHABLE_SPEC_FIELDS) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }
  if (Object.keys(allowed).length === 0) return false;
  const client = await a8sClient();
  await client.patchAgentSpec(agentId, allowed as never);
  return true;
}

/**
 * Inspect an agent's live runtime: the flattened tool set the model sees.
 * a8s exposes this via the product snapshot (tools[]); prompt-block / system-
 * prompt introspection isn't on the control plane yet, so those stay absent
 * (the UI renders an empty section rather than calling a dead route).
 */
export async function inspectAgent(agentId: string): Promise<InspectRuntime> {
  const client = await a8sClient();
  const snap = await client.agentSnapshot(agentId);
  const tools: ToolDef[] = (snap.tools ?? []).map((name) => ({ name }));
  return { tools };
}

/** Read an agent's personal memory (the AGENTS.md-style home doc). */
export async function readAgentMemory(agentId: string): Promise<{ content: string; path: string }> {
  const client = await a8sClient();
  const res = await client.readAgentHome(agentId, 'memory');
  return { content: res.content, path: res.path ?? '' };
}

/** Overwrite an agent's personal memory. */
export async function writeAgentMemory(agentId: string, content: string): Promise<void> {
  const client = await a8sClient();
  await client.writeAgentHome(agentId, 'memory', content);
}

/** Read shared project knowledge files for an agent (read-only aggregate). */
export async function readProjectKnowledge(agentId: string): Promise<Array<{ path: string; content: string }>> {
  const client = await a8sClient();
  const res = await client.readAgentHome(agentId, 'project-knowledge');
  return res.files ?? [];
}

/**
 * Model catalog for the Agents create/edit pickers — derived from the a8s
 * models template (the single source of truth). Tier aliases come first
 * (tier:X), then concrete model ids. providerName/type are best-effort labels.
 */
export async function listModelCatalog(): Promise<ModelCatalogItem[]> {
  const client = await a8sClient();
  const { template } = await client.getModelsTemplate();
  if (!template) return [];
  const items: ModelCatalogItem[] = [];
  for (const tier of Object.keys(template.tiers)) {
    // Tier alias resolves to a concrete model per-worker; surface the target's
    // family so the picker can still family-lock against a tier selection.
    const targetId = template.tiers[tier];
    items.push({ model: `tier:${tier}`, providerName: 'tier', type: 'tier', family: modelFamily(targetId) });
  }
  for (const [id, model] of Object.entries(template.models)) {
    const providerId = model.providers?.[0]?.providerId ?? '';
    const remoteModelId = model.providers?.[0]?.remoteModelId;
    items.push({
      model: id,
      providerName: providerId,
      type: 'model',
      contextWindow: model.contextWindow,
      family: modelFamily(id) ?? modelFamily(remoteModelId),
    });
  }
  return items;
}
