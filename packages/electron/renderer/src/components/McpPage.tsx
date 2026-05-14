import { useMemo } from 'react';
import { Bot, Plug, Server } from 'lucide-react';
import { API, apiFetch } from '../api/paths';
import { useAgentFacts, useSystemFact } from '../facts/useFacts';
import { EmptyState, Pill, SectionCard, WorkbenchPage } from './workbench';
import { McpServerRow } from './SettingsPage';

export default function McpPage() {
  const system = useSystemFact();
  const agents = useAgentFacts();
  const shared = system?.mcpShared ?? [];
  const agentMcpRows = useMemo(
    () =>
      agents
        .flatMap((agent) => (agent.mcp ?? []).map((server) => ({ agent, server })))
        .sort((a, b) => a.agent.name.localeCompare(b.agent.name) || a.server.name.localeCompare(b.server.name)),
    [agents],
  );

  return (
    <WorkbenchPage
      eyebrow="Tools"
      title="MCP"
      description="MCP 是独立工具层：global 共享、project 继承、agent 覆盖。这里看运行状态和开关。"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Global MCP"
              subtitle="共享服务器由 uTool / 全局配置托管，这里只看状态，不提供删除或关闭。"
              icon={<Server size={15} />}
            >
              {shared.length === 0 ? (
                <EmptyState title="没有 Global MCP" body="共享 MCP 配置为空，或当前后端还没有推送 SystemFact。" />
              ) : (
                <div className="space-y-2">
                  {shared.map((server) => (
                    <McpServerRow
                      key={server.name}
                      server={server}
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Agent MCP"
              subtitle="project 和 agent 层合并后的实际运行状态；这里可以临时启停单个 agent 的 MCP。"
              icon={<Bot size={15} />}
            >
              {agentMcpRows.length === 0 ? (
                <EmptyState title="没有 Agent MCP" body="当前没有 agent 级 MCP 运行状态。agent 可能尚未实例化。" />
              ) : (
                <div className="space-y-3">
                  {agentMcpRows.map(({ agent, server }) => (
                    <div key={`${agent.id}:${server.name}`} className="rounded-xl border border-white/[0.07] bg-black/15 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-100">{agent.name}</div>
                          <div className="truncate font-mono text-[11px] text-zinc-600">{agent.id}</div>
                        </div>
                        <Pill>{agent.project ? 'project-bound' : 'workspace-only'}</Pill>
                      </div>
                      <McpServerRow
                        server={server}
                        onToggle={async (enabled) => {
                          const resp = await apiFetch(API.agentMcpEnabled(agent.id, server.name), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enabled }),
                          });
                          const data = await resp.json().catch(() => ({}));
                          if (!resp.ok || data.error) {
                            throw new Error(data.error || `Request failed (${resp.status})`);
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </WorkbenchPage>
  );
}
