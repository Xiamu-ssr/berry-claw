import { Plus, MessageSquare, BarChart3, Settings } from 'lucide-react';
import type { SessionInfo } from '../types';

interface SidebarProps {
  sessions: SessionInfo[];
  activeSessionId?: string;
  activeTab: 'chat' | 'observe' | 'settings';
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onTabChange: (tab: 'chat' | 'observe' | 'settings') => void;
}

export default function Sidebar({
  sessions,
  activeSessionId,
  activeTab,
  onNewSession,
  onSelectSession,
  onTabChange,
}: SidebarProps) {
  return (
    <div className="flex h-full">
      {/* Icon rail */}
      <div className="w-14 bg-berry-700 flex flex-col items-center py-4 gap-2">
        <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center text-berry-700 font-bold text-sm mb-4">
          B
        </div>
        <NavIcon
          icon={<MessageSquare size={20} />}
          active={activeTab === 'chat'}
          onClick={() => onTabChange('chat')}
        />
        <NavIcon
          icon={<BarChart3 size={20} />}
          active={activeTab === 'observe'}
          onClick={() => onTabChange('observe')}
        />
        <div className="flex-1" />
        <NavIcon
          icon={<Settings size={20} />}
          active={activeTab === 'settings'}
          onClick={() => onTabChange('settings')}
        />
      </div>

      {/* Session list — only show on chat tab */}
      {activeTab === 'chat' && (
        <div className="w-56 bg-gray-50 border-r border-gray-200 flex flex-col">
          <button
            onClick={onNewSession}
            className="m-3 px-4 py-2.5 bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
          >
            <Plus size={18} />
            New Session
          </button>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                  activeSessionId === session.id
                    ? 'bg-berry-100 text-berry-800'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate flex-1">
                    {session.id.slice(0, 12)}...
                  </span>
                  {session.totalCost != null && (
                    <span className="text-xs text-gray-400 ml-2">
                      ${session.totalCost.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {new Date(session.startTime ?? session.createdAt ?? Date.now()).toLocaleDateString()}
                </div>
              </button>
            ))}
            {sessions.length === 0 && (
              <p className="text-sm text-gray-400 text-center mt-8">No sessions yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NavIcon({ icon, active, onClick }: { icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
        active ? 'bg-berry-600 text-white' : 'text-berry-300 hover:bg-berry-600/50 hover:text-white'
      }`}
    >
      {icon}
    </button>
  );
}
