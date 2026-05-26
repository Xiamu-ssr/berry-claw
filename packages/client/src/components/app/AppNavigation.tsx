import type * as React from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Inbox,
  PanelLeftClose,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { AgentFact } from '@berry-agent/claw-contracts';
import { cn } from '../../utils/cn';
import { InstancePicker } from '../InstancePicker';
import StatusDot from '../StatusDot';
import type { ClientView } from './types';

export function MobileTopNav({
  activeView,
  onViewChange,
  activeInstanceName,
  connected,
}: {
  activeView: ClientView;
  onViewChange: (view: ClientView) => void;
  activeInstanceName?: string;
  connected: boolean;
}) {
  const items: Array<{ id: ClientView; label: string; icon: React.ReactNode }> = [
    { id: 'inbox', label: '收件箱', icon: <Inbox size={14} /> },
    { id: 'projects', label: '项目', icon: <FolderKanban size={14} /> },
    { id: 'team', label: '团队', icon: <Users size={14} /> },
    { id: 'agents', label: '智能体', icon: <Bot size={14} /> },
    { id: 'audit', label: '审计', icon: <ShieldCheck size={14} /> },
    { id: 'settings', label: '设置', icon: <Settings size={14} /> },
    { id: 'skills', label: 'Skill', icon: <Sparkles size={14} /> },
    { id: 'mcp', label: 'MCP', icon: <Plug size={14} /> },
  ];

  return (
    <div className="hidden border-b border-white/[0.07] bg-[#15171a] max-md:block">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">Berry Claw</div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <StatusDot ok={connected} />
            <span className="truncate">{activeInstanceName ?? '未选择实例'}</span>
          </div>
        </div>
        <div className="w-36">
          <InstancePicker />
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto px-2 pb-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              activeView === item.id
                ? 'bg-sky-300/12 text-sky-100'
                : 'bg-white/[0.035] text-zinc-400 hover:bg-sky-200/[0.07] hover:text-sky-100'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ClientSidebar({
  activeView,
  onViewChange,
  activeInstanceName,
  connected,
  selectedAgent,
  agentCount,
  projectCount,
  collapsed,
  onToggleCollapsed,
  onHideSidebar,
}: {
  activeView: ClientView;
  onViewChange: (view: ClientView) => void;
  activeInstanceName?: string;
  connected: boolean;
  selectedAgent?: AgentFact;
  agentCount: number;
  projectCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onHideSidebar: () => void;
}) {
  return (
    <aside className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent max-md:hidden group">
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        className="absolute right-[-12px] top-6 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.08] bg-[#1a1d21] text-zinc-500 opacity-0 transition-all hover:scale-110 hover:text-zinc-100 group-hover:right-[-12px] group-hover:opacity-100"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
      <button
        type="button"
        onClick={onHideSidebar}
        title="隐藏侧边栏"
        aria-label="隐藏侧边栏"
        className={cn(
          'absolute z-20 flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] bg-[#17191c]/80 text-zinc-500 opacity-70 shadow-sm backdrop-blur-xl transition-all hover:bg-white/[0.06] hover:text-zinc-100 hover:opacity-100',
          collapsed ? 'left-1/2 top-[66px] -translate-x-1/2' : 'right-5 top-6',
        )}
      >
        <PanelLeftClose size={14} />
      </button>

      <div className={cn('transition-all duration-300', collapsed ? 'px-3 py-6' : 'px-5 py-6')}>
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--theme-primary-glow)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] shadow-[0_0_15px_var(--theme-primary-glow)]">
            <Bot size={16} />
          </div>
          <motion.div
            className="min-w-0"
            initial={false}
            animate={{ width: collapsed ? 0 : 'auto', opacity: collapsed ? 0 : 1 }}
            style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
          >
            <div className="text-[13px] font-semibold tracking-wide text-zinc-100">Berry Claw</div>
            <div className="font-mono text-[10px] tracking-wider text-zinc-500">WORKSPACE</div>
          </motion.div>
        </div>
      </div>

      <nav className={cn('min-h-0 flex-1 overflow-y-auto hide-scrollbar', collapsed ? 'px-3' : 'px-4')}>
        <div className="space-y-1">
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'inbox'}
            icon={<Inbox size={16} />}
            label="Inbox"
            onClick={() => selectView('inbox', onViewChange)}
          />
        </div>

        <SidebarGroup title="Workspace" collapsed={collapsed}>
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'projects'}
            icon={<FolderKanban size={16} />}
            label="Projects"
            count={projectCount}
            onClick={() => selectView('projects', onViewChange)}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'team'}
            icon={<Users size={16} />}
            label="Teams"
            onClick={() => selectView('team', onViewChange)}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'agents'}
            icon={<Bot size={16} />}
            label="Agents"
            count={agentCount}
            onClick={() => selectView('agents', onViewChange)}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'audit'}
            icon={<ShieldCheck size={16} />}
            label="Audit"
            onClick={() => selectView('audit', onViewChange)}
          />
        </SidebarGroup>

        <SidebarGroup title="Settings" collapsed={collapsed}>
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'skills'}
            icon={<Sparkles size={16} />}
            label="Skills"
            onClick={() => selectView('skills', onViewChange)}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'mcp'}
            icon={<Plug size={16} />}
            label="MCP"
            onClick={() => selectView('mcp', onViewChange)}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'settings'}
            icon={<Settings size={16} />}
            label="Settings"
            onClick={() => selectView('settings', onViewChange)}
          />
        </SidebarGroup>
      </nav>

      <div className={cn('mt-auto p-4 transition-all duration-300', collapsed ? 'px-3' : 'px-4')}>
        <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-1.5 backdrop-blur-sm">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <StatusDot status={selectedAgent?.status} />
              <StatusDot ok={connected} />
            </div>
          ) : (
            <div className="flex items-center gap-3 px-2 py-1.5">
              <div className="relative">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-zinc-700 to-zinc-800 shadow-inner">
                  <span className="text-xs font-semibold text-zinc-300">
                    {(selectedAgent?.name || 'A')[0].toUpperCase()}
                  </span>
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#17191c]">
                  <StatusDot status={selectedAgent?.status} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-zinc-200">
                  {selectedAgent?.name ?? 'No Agent'}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-zinc-500">
                  <StatusDot ok={connected} />
                  <span className="truncate">{activeInstanceName ?? 'Disconnected'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function SidebarGroup({ title, children, collapsed }: { title: string; children: React.ReactNode; collapsed?: boolean }) {
  return (
    <div className="mt-6">
      {!collapsed && <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{title}</div>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarItem({
  collapsed,
  active,
  icon,
  label,
  badge,
  count,
  onClick,
}: {
  collapsed?: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative flex w-full items-center rounded-xl text-left text-[13px] transition-all duration-200',
        collapsed ? 'h-10 justify-center px-0' : 'gap-3 px-3 py-2',
        active
          ? 'bg-white/[0.06] font-medium text-zinc-100'
          : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200',
      )}
    >
      {active && !collapsed && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute left-0 top-1/2 h-1/2 w-1 -translate-y-1/2 rounded-r-full bg-[var(--theme-primary)]"
        />
      )}
      <span className={cn('transition-colors', active ? 'text-[var(--theme-primary)]' : 'text-zinc-500 group-hover:text-zinc-300')}>
        {icon}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {typeof count === 'number' && count > 0 && (
            <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-400 group-hover:bg-white/[0.08]">
              {count}
            </span>
          )}
          {badge && (
            <span className="max-w-16 truncate rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function selectView(view: ClientView, onViewChange: (view: ClientView) => void): void {
  onViewChange(view);
  localStorage.setItem('berry-active-view', view);
}
