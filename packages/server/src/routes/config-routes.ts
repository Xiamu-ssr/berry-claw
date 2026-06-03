import type { Express } from 'express';
import { CONFIG_SCHEMA_VERSION } from '../engine/config-manager.js';
import type { AgentManager } from '../engine/agent-manager.js';
import {
  zCredentialUpdateRequest,
  zModelBindingUpsertRequest,
  zModelSwitchRequest,
  zProviderInstanceUpsertRequest,
  zTierUpdateRequest,
} from '@berry-agent/claw-contracts';
import { WEB_SEARCH_CREDENTIAL_META, type CredentialKeyMeta } from '@berry-agent/tools-common';
import { listPromptPacks } from '@berry-agent/prompt-pack';

const KNOWN_CREDENTIAL_KEYS: readonly CredentialKeyMeta[] = [
  ...WEB_SEARCH_CREDENTIAL_META,
  // Add other categories here as the SDK grows (e.g. browser auth tokens).
];

/**
 * Mask API keys for display: show a short prefix + a run of bullets + last 3
 * characters. Anything <= 8 chars is fully bulleted to avoid leaking keys.
 * Example: sk-proj-abc...xyz -> "sk-pro........xyz"
 */
function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return key.slice(0, 6) + '•'.repeat(8) + key.slice(-3);
}

export function registerConfigRoutes(app: Express, manager: AgentManager): void {
  /** Get full config (apiKeys masked for safety). */
  app.get('/api/config', (_req, res) => {
    const config = manager.config.get();
    const maskedProviders = Object.fromEntries(
      Object.entries(config.providerInstances).map(([k, v]) => [
        k,
        { ...v, apiKey: maskKey(v.apiKey) },
      ]),
    );
    res.json({
      schemaVersion: CONFIG_SCHEMA_VERSION,
      providerInstances: maskedProviders,
      models: config.models,
      tiers: config.tiers,
      agents: config.agents,
      defaultAgent: config.defaultAgent,
      safetyClassifier: config.safetyClassifier ?? null,
    });
  });

  /** Configuration status. */
  app.get('/api/config/status', (_req, res) => {
    res.json({
      configured: manager.config.isConfigured,
      firstModel: manager.config.firstConfiguredModelId(),
      tiers: manager.config.getTiers(),
    });
  });

  app.get('/api/config/provider-instances', (_req, res) => {
    const items = manager.config.listProviderInstances().map(({ id, entry }) => ({
      id,
      entry: { ...entry, apiKey: maskKey(entry.apiKey) },
    }));
    res.json({ providerInstances: items });
  });

  app.put('/api/config/provider-instances/:id', (req, res) => {
    const parsed = zProviderInstanceUpsertRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { presetId, apiKey, baseUrl, type, knownModels, label } = parsed.data;
    const existing = manager.config.getProviderInstance(req.params.id);
    const resolvedKey = apiKey || existing?.apiKey;
    if (!resolvedKey) {
      return res.status(400).json({ error: 'apiKey required for new provider instances' });
    }
    manager.config.setProviderInstance(req.params.id, {
      id: req.params.id,
      presetId,
      apiKey: resolvedKey,
      baseUrl,
      type,
      knownModels,
      label,
    });
    res.json({ ok: true });
  });

  app.delete('/api/config/provider-instances/:id', (req, res) => {
    manager.config.removeProviderInstance(req.params.id);
    res.json({ ok: true });
  });

  /** Fetch live models for a configured provider instance. */
  app.get('/api/config/provider-instances/:id/models', async (req, res) => {
    const entry = manager.config.getProviderInstance(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Provider instance not found' });
    const { listModels } = await import('@berry-agent/models');
    try {
      const result = await listModels(entry);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Built-in provider presets (static catalog). */
  app.get('/api/config/presets', async (_req, res) => {
    const { listBuiltinPresets } = await import('@berry-agent/models');
    res.json({ presets: listBuiltinPresets() });
  });

  app.get('/api/config/models', (_req, res) => {
    res.json({ models: manager.config.listModels() });
  });

  app.put('/api/config/models/:id', async (req, res) => {
    const parsed = zModelBindingUpsertRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { providers, label, contextWindow } = parsed.data;
    if (
      contextWindow !== undefined &&
      contextWindow !== null &&
      (!Number.isFinite(Number(contextWindow)) || Number(contextWindow) < 4_000 || Number(contextWindow) > 10_000_000)
    ) {
      return res.status(400).json({ error: 'contextWindow must be between 4000 and 10000000 tokens' });
    }
    manager.config.setModel(req.params.id, {
      id: req.params.id,
      label,
      ...(contextWindow ? { contextWindow: Math.floor(Number(contextWindow)) } : {}),
      providers,
    });
    await manager.rebuildLiveAgentsForModel(req.params.id);
    res.json({ ok: true });
  });

  app.delete('/api/config/models/:id', async (req, res) => {
    manager.config.removeModel(req.params.id);
    await manager.rebuildLiveAgentsForModel(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/config/tiers', (_req, res) => {
    res.json({ tiers: manager.config.getTiers() });
  });

  app.put('/api/config/tiers/:tier', async (req, res) => {
    const tier = req.params.tier;
    if (tier !== 'strong' && tier !== 'balanced' && tier !== 'fast') {
      return res.status(400).json({ error: `Unknown tier "${tier}"` });
    }
    const parsed = zTierUpdateRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { modelId } = parsed.data;
    manager.config.setTier(tier, typeof modelId === 'string' ? modelId : null);
    await manager.rebuildLiveAgentsForTier(tier);
    res.json({ ok: true });
  });

  /** List known credential keys + whether each is configured. */
  app.get('/api/credentials', (_req, res) => {
    const store = manager.credentials;
    const items = KNOWN_CREDENTIAL_KEYS.map(entry => ({
      ...entry,
      configured: store.has?.(entry.key) ?? false,
      source: store.source?.(entry.key) ?? null,
    }));
    res.json({ credentials: items });
  });

  /** Set or update a credential (writes to backing file, 600 perms). */
  app.put('/api/credentials/:key', async (req, res) => {
    const { key } = req.params;
    const parsed = zCredentialUpdateRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { value } = parsed.data;
    if (!KNOWN_CREDENTIAL_KEYS.some(e => e.key === key)) {
      return res.status(400).json({ error: `Unknown credential key: ${key}` });
    }
    const store = manager.credentials as { set?: (k: string, v: string) => Promise<void> };
    if (!store.set) return res.status(500).json({ error: 'Credential store not writable' });
    try {
      await store.set(key, value.trim());
      res.json({ ok: true, key, source: manager.credentials.source?.(key) ?? null });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Delete a credential (file-backed only; env vars are not touched). */
  app.delete('/api/credentials/:key', async (req, res) => {
    const { key } = req.params;
    const store = manager.credentials as { delete?: (k: string) => Promise<void> };
    if (!store.delete) return res.status(500).json({ error: 'Credential store not writable' });
    try {
      await store.delete(key);
      res.json({ ok: true, key });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Flat model list used by the chat-area model switcher and the AgentsPage
   * model dropdown; this is a view-only projection of Layer-2 bindings.
   * Pass ?agentId to include that agent's currently-resolved model as `current`.
   */
  app.get('/api/models', (req, res) => {
    const bindings = manager.config.listModels();
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    res.json({
      models: bindings.map(({ id, entry }) => ({
        model: id,
        providerName: entry.providers[0]?.providerId ?? '',
        type: 'model',
        contextWindow: entry.contextWindow,
      })),
      current: agentId ? manager.currentModel(agentId) : null,
    });
  });

  app.get('/api/prompt-packs', (_req, res) => {
    res.json({ promptPacks: listPromptPacks(manager.config.promptPacksDir()) });
  });

  /** Switch model at runtime (accepts tier:X / model:X / bare id). */
  app.post('/api/models/switch', async (req, res) => {
    const parsed = zModelSwitchRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      await manager.switchModel(parsed.data.agentId, parsed.data.model);
      res.json({ ok: true, current: manager.currentModel(parsed.data.agentId) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}
