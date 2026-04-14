// Observe Dashboard — powered by @berry-agent/observe UI components
// Uses the full ObserveApp from the SDK (10 views: overview, cost, cache, guard, compaction, inferences, sessions, agents)
import { ObserveApp } from '../../../../berry-agent-sdk/packages/observe/ui/src/components/ObserveApp';

export default function ObserveDashboard() {
  return (
    <div className="flex-1 overflow-hidden">
      <ObserveApp baseUrl="/api/observe" />
    </div>
  );
}
