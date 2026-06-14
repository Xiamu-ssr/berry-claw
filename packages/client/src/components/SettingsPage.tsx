import { lazy, Suspense, useState, useEffect } from 'react';
import SettingsNav from './settings/SettingsNav';
import type { SettingsTabId } from './settings/types';
import { InlineSpinner, WorkbenchPage } from './workbench';

const ConnectionsTab = lazy(() => import('./ConnectionsTab').then(mod => ({ default: mod.ConnectionsTab })));
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
      description="连接后端实例与外观主题。"
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
