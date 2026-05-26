import { ObserveApp } from '../../../../../berry-agent-sdk/packages/observe/ui/src';
import { API, apiFetch } from '../api/paths';
import { WorkbenchPage } from './workbench';

const observeFetcher: typeof fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input.toString();
  const url = raw.startsWith(API.observe)
    ? raw
    : `${API.observe}${raw.startsWith('/') ? raw : `/${raw}`}`;
  return apiFetch(url, init);
};

export default function AuditPage() {
  return (
    <WorkbenchPage
      eyebrow="Observe"
      title="审计"
      description="查看 SDK 记录的 session、turn、推理、成本、缓存、guard 和 compaction。"
    >
      <div className="h-[calc(100vh-64px)] min-h-0 overflow-hidden bg-[#1b1e22]">
        <ObserveApp baseUrl={API.observe} fetcher={observeFetcher} />
      </div>
    </WorkbenchPage>
  );
}
