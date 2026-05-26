import type * as React from 'react';
import {
  Folder,
  Globe2,
  GripVertical,
  MessageSquare,
} from 'lucide-react';
import type { TodoItem } from '@berry-agent/claw-contracts';
import { cn } from '../utils/cn';
import { BrowserRail } from './workspace/BrowserRail';
import { FilesRail } from './workspace/FilesRail';
import { SessionRailContent } from './workspace/SessionRailContent';
import type {
  AnnotationAttachment,
  AnnotationBlock,
  SessionListItem,
  WorkspaceRailTab,
} from './workspace/types';

export type {
  AnnotationAttachment,
  AnnotationBlock,
  SessionListItem,
  WorkspaceRailTab,
} from './workspace/types';

interface WorkspaceRailProps {
  activeTab: WorkspaceRailTab;
  onTabChange: (tab: WorkspaceRailTab) => void;
  agentId?: string;
  sessions: SessionListItem[];
  todos: TodoItem[];
  activeSessionId?: string;
  newSessionDisabled: boolean;
  onResumeSession: (sessionId: string) => void;
  onNewSession: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onAnnotationCreated: (block: AnnotationBlock) => void;
}

const TABS = [
  { id: 'browser' as const, label: 'Browser', icon: <Globe2 size={14} /> },
  { id: 'files' as const, label: 'Files', icon: <Folder size={14} /> },
  { id: 'session' as const, label: 'Session', icon: <MessageSquare size={14} /> },
];

export default function WorkspaceRail({
  activeTab,
  onTabChange,
  agentId,
  sessions,
  todos,
  activeSessionId,
  newSessionDisabled,
  onResumeSession,
  onNewSession,
  onResizeStart,
  onAnnotationCreated,
}: WorkspaceRailProps) {
  return (
    <aside className="relative min-h-0 overflow-hidden border-l border-white/[0.04] bg-[#111315]/50 max-lg:hidden">
      <div
        role="separator"
        aria-label="调整右侧栏宽度"
        title="拖拽调整右侧栏宽度"
        onPointerDown={onResizeStart}
        className="absolute left-0 top-0 z-20 flex h-full w-3 cursor-col-resize items-center justify-center border-l border-transparent text-zinc-700 transition-colors hover:border-[var(--theme-primary-hover)] hover:bg-[var(--theme-primary-soft)] hover:text-[var(--theme-primary)]"
      >
        <GripVertical size={12} />
      </div>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1 border-b border-white/[0.04] p-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]'
                  : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 hide-scrollbar">
          {activeTab === 'browser' && (
            <BrowserRail onAnnotationCreated={onAnnotationCreated} />
          )}
          {activeTab === 'files' && (
            <FilesRail agentId={agentId} />
          )}
          {activeTab === 'session' && (
            <SessionRailContent
              sessions={sessions}
              todos={todos}
              activeSessionId={activeSessionId}
              newSessionDisabled={newSessionDisabled}
              onResumeSession={onResumeSession}
              onNewSession={onNewSession}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
