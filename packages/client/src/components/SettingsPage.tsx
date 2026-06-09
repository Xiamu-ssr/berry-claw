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
 *   3. 安全 (Safety) — read-only; policy lives in each agent's a8s spec
 *   4. 工具凭证 (Credentials) — read-only; secrets live on the machine
 */
import { lazy, Suspense, useState, useEffect } from 'react';
import SettingsNav from './settings/SettingsNav';
import type { SettingsTabId } from './settings/types';
import { InlineSpinner, WorkbenchPage } from './workbench';

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

  return (
    <WorkbenchPage
      eyebrow="Config"
      title="设置"
      description="连接后端实例与外观主题。模型/供应商/档位、安全策略、工具凭证均由 a8s 控制台或机器侧管理。"
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
            {tab === 'safety' && <SafetyTab />}
            {tab === 'credentials' && <CredentialsTab />}
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
