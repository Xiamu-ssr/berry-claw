import { useState } from 'react';
import { Plus, MessageSquare, BarChart3, Settings, Menu, X, Bot } from 'lucide-react';
import AgentSelector from './AgentSelector';
import type { SessionInfo } from '../types';

interface SidebarProps {
  sessions: SessionInfo[];
  activeSessionId?: string;
  activeTab: 'chat' | 'observe' | 'agents' | 'settings';
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onTabChange: (tab: 'chat' | 'observe' | 'agents' | 'settings') => void;
}

export default function Sidebar({
  sessions,
  activeSessionId,
  activeTab,
  onNewSession,
  onSelectSession,
  onTabChange,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleTabChange = (tab: 'chat' | 'observe' | 'agents' | 'settings') => {
    onTabChange(tab);
    setMobileOpen(false);
  };

  const handleSelectSession = (id: string) => {
    onSelectSession(id);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 w-10 h-10 rounded-lg bg-berry-600 text-white flex items-center justify-center shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar container */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-50
        transform transition-transform duration-200 ease-in-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        flex h-full
      `}>
        {/* Icon rail */}
        <div className="w-14 bg-berry-700 flex flex-col items-center py-4 gap-2 flex-shrink-0">
          <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center text-berry-700 font-bold text-sm mb-4">
            B
          </div>
          <NavIcon
            icon={<MessageSquare size={20} />}
            active={activeTab === 'chat'}
            onClick={() => handleTabChange('chat')}
          />
          <NavIcon
            icon={<Bot size={20} />}
            active={activeTab === 'agents'}
            onClick={() => handleTabChange('agents')}
          />
          <NavIcon
            icon={<BarChart3 size={20} />}
            active={activeTab === 'observe'}
            onClick={() => handleTabChange('observe')}
          />
          <div className="flex-1" />
          <NavIcon
            icon={<Settings size={20} />}
            active={activeTab === 'settings'}
            onClick={() => handleTabChange('settings')}
          />
        </div>

        {/* Session list — only show on chat tab */}
        {activeTab === 'chat' && (
          <div className="w-56 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
            {/* Mobile close button */}
            <div className="md:hidden flex justify-end p-2">
              <button onClick={() => setMobileOpen(false)} className="text-gray-500 dark:text-gray-400 p-1">
                <X size={20} />
              </button>
            </div>
            <AgentSelector />
            <button
              onClick={() => { onNewSession(); setMobileOpen(false); }}
              className="mx-3 mb-3 px-4 py-2.5 bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
            >
              <Plus size={18} />
              New Session
            </button>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                    activeSessionId === session.id
                      ? 'bg-berry-100 dark:bg-berry-900/40 text-berry-800 dark:text-berry-200'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate flex-1">
                      {session.title || session.id.slice(0, 16) + '...'}
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
    </>
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
