import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ObserveDashboard from './components/ObserveDashboard';
import SettingsPage from './components/SettingsPage';
import { useWebSocket } from './hooks/useWebSocket';
import type { ChatMessage, SessionInfo, ToolCallInfo, WsIncoming } from './types';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [activeTab, setActiveTab] = useState<'chat' | 'observe' | 'settings'>('chat');

  // Pending tool calls for current assistant message
  const pendingToolsRef = useRef<ToolCallInfo[]>([]);

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      // Server not ready yet
    }
  };

  const handleWsMessage = useCallback((msg: WsIncoming) => {
    switch (msg.type) {
      case 'start':
        setIsLoading(true);
        setStreamingText('');
        pendingToolsRef.current = [];
        break;

      case 'text_delta':
        setStreamingText((prev) => prev + msg.text);
        break;

      case 'tool_call':
        pendingToolsRef.current.push({
          name: msg.name,
          input: msg.input,
        });
        // Show tool call in streaming area
        setStreamingText((prev) => prev);
        break;

      case 'tool_result':
        // Update the last matching tool call with result
        const tools = pendingToolsRef.current;
        const lastMatch = [...tools].reverse().find(t => t.name === msg.name);
        if (lastMatch) {
          lastMatch.isError = msg.isError;
        }
        break;

      case 'done': {
        const text = streamingTextRef.current;
        const toolCalls = [...pendingToolsRef.current];
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: msg.usage,
          },
        ]);
        setStreamingText('');
        setIsLoading(false);
        setActiveSessionId(msg.sessionId);
        pendingToolsRef.current = [];
        fetchSessions();
        break;
      }

      case 'error':
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: `❌ Error: ${msg.message}`,
            timestamp: Date.now(),
          },
        ]);
        setStreamingText('');
        setIsLoading(false);
        break;

      case 'session_cleared':
        setMessages([]);
        setActiveSessionId(undefined);
        break;

      case 'session_resumed':
        setActiveSessionId(msg.sessionId);
        if (msg.messages && msg.messages.length > 0) {
          setMessages(msg.messages);
        }
        break;
    }
  }, []);

  // Keep ref of streaming text for use in 'done' handler
  const streamingTextRef = useRef('');
  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  const { send, connected } = useWebSocket(handleWsMessage);

  const handleSend = useCallback(
    (prompt: string) => {
      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ]);
      // Send to server
      send({ type: 'chat', prompt, sessionId: activeSessionId });
    },
    [send, activeSessionId],
  );

  const handleNewSession = useCallback(() => {
    send({ type: 'new_session' });
    setMessages([]);
    setActiveSessionId(undefined);
  }, [send]);

  const handleSelectSession = useCallback(
    (id: string) => {
      send({ type: 'resume_session', sessionId: id });
      setMessages([]); // Will be populated by session_resumed response
      setActiveSessionId(id);
      setActiveTab('chat');
    },
    [send],
  );

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        activeTab={activeTab}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onTabChange={setActiveTab}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Connection status */}
        {!connected && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-700">
            ⚠️ Disconnected from server. Reconnecting...
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatArea
            messages={messages}
            streamingText={streamingText}
            isLoading={isLoading}
            onSend={handleSend}
          />
        )}

        {activeTab === 'observe' && <ObserveDashboard />}

        {activeTab === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}

function genId(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
