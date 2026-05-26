/**
 * SettingsPage — v2 schema (provider instances + models + tiers + agents).
 *
 * Tabs (top-level):
 *   1. Providers  — Layer 1: instances keyed by user-chosen id, one apiKey each
 *   2. Models     — Layer 2: model bindings aggregating providers (failover order)
 *   3. Tiers      — Layer 3: strong / balanced / fast shortcuts
 *   4. Credentials (tool secrets — unchanged)
 *
 * Notes:
 *  - Agents are managed on their own page (AgentsPage). This page focuses
 *    purely on the 3-layer model binding surface.
 *  - apiKeys are shown masked (`sk-xxx…abc`). Leaving the field blank on
 *    update keeps the existing key (server semantics).
 */
import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { API, apiFetch } from '../api/paths';
import type {
  ConfigProviderPreset as ProviderPreset,
  ConfigResponse as ConfigPayload,
} from '@berry-agent/claw-contracts';
import SettingsNav from './settings/SettingsNav';
import type { SettingsTabId } from './settings/types';
import {
  EmptyState,
  InlineSpinner,
  Pill,
  PrimaryButton,
  WorkbenchPage,
} from './workbench';

const ConnectionsTab = lazy(() => import('./ConnectionsTab').then(mod => ({ default: mod.ConnectionsTab })));
const CredentialsTab = lazy(() => import('./settings/CredentialsTab'));
const ModelsTab = lazy(() => import('./settings/ModelsTab'));
const ProvidersTab = lazy(() => import('./settings/ProvidersTab'));
const SafetyTab = lazy(() => import('./settings/SafetyTab'));
const ThemeTab = lazy(() => import('./settings/ThemeTab'));
const TiersTab = lazy(() => import('./settings/TiersTab'));

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTabId>('providers');

  useEffect(() => {
    const handler = () => setTab('connections');
    window.addEventListener('berry-claw:open-connections-tab', handler);
    return () => window.removeEventListener('berry-claw:open-connections-tab', handler);
  }, []);

  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);

  const refresh = useCallback(async () => {
    const [cfg, presetRes] = await Promise.all([
      apiFetch(API.config).then(r => r.json()),
      apiFetch(API.configPresets).then(r => r.json()),
    ]);
    setConfig(cfg);
    setPresets(presetRes.presets ?? []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <WorkbenchPage
      eyebrow="Config"
      title="设置"
      description="连接后端实例，维护 SDK 级模型配置和工具凭证。Agent、Skill、MCP 各有独立栏目。"
      actions={
        <PrimaryButton onClick={refresh}>
          <RefreshCw size={14} />
          刷新配置
        </PrimaryButton>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <SettingsNav
          active={tab}
          onChange={setTab}
        />
        <Suspense fallback={<SettingsTabFallback />}>
          <div className="space-y-4 p-5 pb-20">
            {tab === 'connections' && <ConnectionsTab />}
            {tab === 'theme' && <ThemeTab />}
            {tab === 'providers' && config && <ProvidersTab config={config} presets={presets} onChange={refresh} />}
            {tab === 'models' && config && <ModelsTab config={config} onChange={refresh} />}
            {tab === 'tiers' && config && <TiersTab config={config} onChange={refresh} />}
            {tab === 'safety' && config && <SafetyTab config={config} />}
            {tab === 'credentials' && <CredentialsTab />}
            {!config && tab !== 'connections' && tab !== 'theme' && tab !== 'credentials' && (
              <EmptyState title="配置还在读取" body="如果一直停在这里，请检查后端实例连接和认证状态。" />
            )}
          </div>
        </Suspense>
      </div>
    </WorkbenchPage>
  );
}

function SettingsTabFallback() {
  return (
    <div className="p-5 pb-20">
      <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
        <InlineSpinner label="Loading settings tab" />
      </section>
    </div>
  );
}
