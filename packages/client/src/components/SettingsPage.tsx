/**
 * SettingsPage — the thin-shell settings surface.
 *
 * Model / provider / tier configuration moved to a8s (the control plane owns
 * the 3-layer model binding now — see berry-claw AGENTS.md "the front-end does
 * not hold model/provider config"). This page keeps only what berry-claw
 * itself owns locally:
 *
 *   1. 后端实例 (Connections) — which a8s instance to talk to
 *   2. 外观主题 (Theme)
 *   3. 安全 (Safety) — three-tier approval mode
 *   4. 工具凭证 (Credentials) — tool secrets
 */
import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { API, apiFetch } from '../api/paths';
import type { ConfigResponse as ConfigPayload } from '@berry-agent/claw-contracts';
import SettingsNav from './settings/SettingsNav';
import type { SettingsTabId } from './settings/types';
import {
  EmptyState,
  InlineSpinner,
  PrimaryButton,
  WorkbenchPage,
} from './workbench';

const ConnectionsTab = lazy(() => import('./ConnectionsTab').then(mod => ({ default: mod.ConnectionsTab })));
const CredentialsTab = lazy(() => import('./settings/CredentialsTab'));
const SafetyTab = lazy(() => import('./settings/SafetyTab'));
const ThemeTab = lazy(() => import('./settings/ThemeTab'));

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTabId>('connections');

  useEffect(() => {
    const handler = () => setTab('connections');
    window.addEventListener('berry-claw:open-connections-tab', handler);
    return () => window.removeEventListener('berry-claw:open-connections-tab', handler);
  }, []);

  const [config, setConfig] = useState<ConfigPayload | null>(null);

  const refresh = useCallback(async () => {
    const cfg = await apiFetch(API.config).then(r => r.json());
    setConfig(cfg);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <WorkbenchPage
      eyebrow="Config"
      title="设置"
      description="连接后端实例、外观、安全策略与工具凭证。模型/供应商/档位的配置已上移到 a8s 控制台。"
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
            {tab === 'safety' && config && <SafetyTab config={config} />}
            {tab === 'credentials' && <CredentialsTab />}
            {!config && tab === 'safety' && (
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
