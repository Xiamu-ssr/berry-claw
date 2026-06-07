import { Server } from 'lucide-react';
import { useSystemFact } from '../facts/useFacts';
import { EmptyState, SectionCard, WorkbenchPage } from './workbench';
import McpServerRow from './mcp/McpServerRow';

export default function McpPage() {
  const system = useSystemFact();
  const shared = system?.mcpShared ?? [];

  return (
    <WorkbenchPage
      eyebrow="Tools"
      title="MCP"
      description="MCP 是独立工具层：global 共享、project 继承、agent 覆盖。这里看运行状态和开关。"
    >
      <div className="min-h-0 w-full h-full overflow-y-auto px-4 md:px-8 py-6 hide-scrollbar">
        <div className="space-y-6 pb-20">
          <div className="grid gap-6 xl:grid-cols-2">
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
              title="Agent / Hand MCP"
              subtitle="MCP 属于 Hand host（本机或 machine 连接器），由 a8s 装配到 agent。这里不再代管 per-agent 启停。"
              icon={<Server size={15} />}
            >
              <EmptyState
                title="MCP 归 Hand host 所有"
                body="某个 agent 挂载哪些 MCP，是 a8s 的 Hand 装配结果；启停在 Hand host 的 .mcp.json，控制台只读展示 Global 状态。"
              />
            </SectionCard>
          </div>
        </div>
      </div>
    </WorkbenchPage>
  );
}
