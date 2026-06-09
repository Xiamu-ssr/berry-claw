import { useEffect, useState } from 'react';
import type * as React from 'react';
import { Bot, FileText, FolderKanban, ShieldCheck } from 'lucide-react';
import StatusDot from './StatusDot';
import { modelShortName } from '../utils/format';
import type { ProjectSummary } from '../projects/summary';

interface ProjectsPageProps {
  projects: ProjectSummary[];
  selectedAgentId?: string;
  onOpenAgent: (agentId: string) => void;
}

export default function ProjectsPage({
  projects,
  selectedAgentId,
  onOpenAgent,
}: ProjectsPageProps) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(projects[0]?.key);
  const selected = projects.find((project) => project.key === selectedKey) ?? projects[0];

  useEffect(() => {
    if (!projects.length) {
      setSelectedKey(undefined);
      return;
    }
    if (!selectedKey || !projects.some((project) => project.key === selectedKey)) {
      setSelectedKey(projects[0]?.key);
    }
  }, [projects, selectedKey]);

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <PageHeader
        icon={<FolderKanban size={18} />}
        title="项目"
      />

      <div className="grid h-[calc(100vh-64px)] min-h-0 grid-cols-[320px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="min-h-0 overflow-y-auto border-r border-white/[0.07] bg-[#17191c] p-3">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
              还没有项目绑定
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.key}
                  onClick={() => setSelectedKey(project.key)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    project.key === selected?.key
                      ? 'border-sky-200/24 bg-sky-200/[0.075]'
                      : 'border-white/[0.07] bg-white/[0.025] hover:border-sky-200/16 hover:bg-sky-200/[0.055]'
                  }`}
                >
                  <div className="truncate text-sm font-medium text-zinc-100">{project.name}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-zinc-600">{project.path}</div>
                  <div className="mt-2 flex gap-1.5">
                    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{project.agents.length} agents</span>
                    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{project.teams.length} teams</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <EmptyPanel
              icon={<FolderKanban size={22} />}
              title="还没有项目绑定"
              body="在智能体里设置 project 后，这里会显示该项目下的 agents 和 teams。"
            />
          ) : (
            <ProjectDetail
              project={selected}
              selectedAgentId={selectedAgentId}
              onOpenAgent={onOpenAgent}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  selectedAgentId,
  onOpenAgent,
}: {
  project: ProjectSummary;
  selectedAgentId?: string;
  onOpenAgent: (agentId: string) => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#20242a]/75">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">project dossier</div>
          <h2 className="mt-1 truncate text-lg font-semibold text-zinc-100">{project.name}</h2>
          <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{project.path}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
          <ProjectStat label="Agents" value={project.agents.length} />
          <ProjectStat label="Teams" value={project.teams.length} />
        </div>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-400">
            <Bot size={13} />
            绑定主体
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {project.agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onOpenAgent(agent.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  agent.id === selectedAgentId
                    ? 'border-sky-200/24 bg-sky-200/[0.075]'
                    : 'border-white/[0.07] bg-black/10 hover:border-sky-200/16 hover:bg-sky-200/[0.055]'
                }`}
              >
                <StatusDot status={agent.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-100">{agent.name}</div>
                  <div className="truncate text-[11px] text-zinc-600">{modelShortName(agent.model)}</div>
                </div>
              </button>
            ))}
          </div>
          {project.agents.length === 0 && (
            <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">
              这个项目目前没有绑定 agent。
            </div>
          )}
        </div>
        {project.key === '__unbound__' ? (
          <div className="rounded-lg border border-white/[0.07] bg-black/10 p-3 text-xs leading-relaxed text-zinc-500">
            这些 agent 还没有绑定 project。绑定后才可以加入团队。
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-white/[0.07] bg-black/10 p-3">
            <ProjectSafetyPanel project={project} />
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
              <FileText size={13} />
              项目事实源
            </div>
            {project.paths ? (
              <>
                <ProjectFile label="project knowledge" path={project.paths.contextPath} />
                <ProjectFile label="team state" path={project.paths.teamPath} />
                <ProjectFile label="team messages" path={project.paths.teamMessagesPath} />
                <ProjectFile label="worklist" path={project.paths.worklistPath} />
              </>
            ) : (
              <div className="rounded-md border border-dashed border-white/[0.08] px-2 py-3 text-center text-[11px] text-zinc-600">
                项目路径快照尚未加载
              </div>
            )}
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-600">Teams</div>
              {project.teams.length > 0 ? (
                <div className="space-y-1">
                  {project.teams.map((team) => (
                    <div key={team.id} className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                      <div className="truncate text-xs text-zinc-300">{team.name}</div>
                      <div className="mt-0.5 text-[10px] text-zinc-600">{team.worklist.length} tasks · {team.messageCount} messages</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/[0.08] px-2 py-3 text-center text-[11px] text-zinc-600">
                  还没有 team 绑定这个 project
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2 text-right">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function ProjectSafetyPanel({ project: _project }: { project: ProjectSummary }) {
  // Project-layer safety was a console-backend snapshot/PATCH. Under direct-
  // connect, safety lives in each agent's a8s spec (agent > project > global
  // cascade resolved server-side), and there is no console route to set the
  // project layer. Degrade to a read-only notice rather than a dead PATCH.
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
        <ShieldCheck size={13} />
        项目安全策略
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2.5 text-[11px] leading-4 text-zinc-500">
        安全策略归 a8s 的 agent spec(按 agent / project / global 继承)。控制台暂不提供项目层改写,请在 a8s 上调整。
      </div>
    </div>
  );
}

function ProjectFile({ label, path }: { label: string; path: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 truncate font-mono text-[11px] text-zinc-500" title={path}>{path}</div>
    </div>
  );
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="border-b border-white/[0.07] px-4 py-4 lg:px-6">
      <div className="flex items-center gap-2">
        <span className="text-sky-300">{icon}</span>
        <h1 className="text-base font-semibold text-zinc-100">{title}</h1>
      </div>
      {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.10] bg-white/[0.02] px-6 text-center">
      <div className="mb-3 text-zinc-500">{icon}</div>
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <div className="mt-1 max-w-md text-sm text-zinc-500">{body}</div>
    </div>
  );
}
