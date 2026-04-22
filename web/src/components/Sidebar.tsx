import { useState } from 'react';
import { MessageSquare, BarChart3, Settings, Menu, X, Bot, Users, RefreshCw } from 'lucide-react';
import AgentSelector from './AgentSelector';

interface SidebarProps {
  activeTab: 'chat' | 'observe' | 'agents' | 'team' | 'settings';
  onCompact: () => void;
  onTabChange: (tab: 'chat' | 'observe' | 'agents' | 'team' | 'settings') => void;
}

export default function Sidebar({
  activeTab,
  onCompact,
  onTabChange,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleTabChange = (tab: 'chat' | 'observe' | 'agents' | 'team' | 'settings') => {
    onTabChange(tab);
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
            icon={<Users size={20} />}
            active={activeTab === 'team'}
            onClick={() => handleTabChange('team')}
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

        {/* Panel — only on chat tab */}
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
              onClick={() => { onCompact(); setMobileOpen(false); }}
              className="mx-3 mb-3 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
              title="Compact session — collapse old messages into a summary (like /new)"
            >
              <RefreshCw size={18} />
              Compact
            </button>
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
