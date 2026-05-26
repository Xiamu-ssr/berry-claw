/**
 * useAgentRuntimes — owns one AgentRuntime per agentId.
 *
 * Single source of truth for chat streaming state. Subscribes to WS frames,
 * dispatches them via {@link applyEvent}, and exposes a read selector keyed
 * by agentId. Side effects produced by the reducer are bubbled out via
 * {@link AgentRuntimeHandlers} so React-aware concerns (toasts, REST
 * refreshes, fact store, safety dialogs) stay outside the pure reducer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { WsIncoming } from '@berry-agent/claw-contracts';

import {
  applyEvent,
  createAgentRuntime,
  type AgentRuntime,
  type RuntimeEffect,
} from './runtime';

export interface AgentRuntimeHandlers {
  onEffect: (agentId: string, effect: RuntimeEffect) => void;
}

export interface UseAgentRuntimesResult {
  /** Look up the runtime for an agent, materialising an empty one on demand. */
  getRuntime: (agentId: string) => AgentRuntime;
  /** Apply an arbitrary WS frame; the dispatcher routes by agentId. */
  dispatch: (frame: WsIncoming) => void;
  /** Drop the runtime for an agent — used when an agent is deleted. */
  forgetAgent: (agentId: string) => void;
  /** Optimistically prepend a user message; used by send() before WS ack. */
  appendOptimisticUserMessage: (agentId: string, message: import('@berry-agent/claw-contracts').ChatMessage) => void;
  /** Imperative helpers used by REST refreshes that have no matching frame. */
  setActiveSession: (agentId: string, sessionId: string | undefined, messages?: import('@berry-agent/claw-contracts').ChatMessage[]) => void;
  setContext: (agentId: string, tokensUsed: number, window: number | null) => void;
  setTodos: (agentId: string, sessionId: string, todos: import('@berry-agent/claw-contracts').TodoItem[]) => void;
  setCreatingSession: (agentId: string, value: boolean) => void;
  resetForAgentSwitch: (agentId: string) => void;
  /** Snapshot of the entire runtime map; rerenders only when something changed. */
  runtimes: ReadonlyMap<string, AgentRuntime>;
}

/**
 * Owns the per-agent runtime map. The reducer is pure; this hook is the only
 * place that knows about React lifecycles, effect queues, and global
 * subscribers.
 */
export function useAgentRuntimes(handlers: AgentRuntimeHandlers): UseAgentRuntimesResult {
  const [runtimes, setRuntimes] = useState<ReadonlyMap<string, AgentRuntime>>(() => new Map());
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const ensureRuntime = useCallback((agentId: string, map: ReadonlyMap<string, AgentRuntime>): AgentRuntime => {
    return map.get(agentId) ?? createAgentRuntime(agentId);
  }, []);

  const replaceRuntime = useCallback((agentId: string, transform: (runtime: AgentRuntime) => AgentRuntime, effects?: RuntimeEffect[]) => {
    setRuntimes((prev) => {
      const current = ensureRuntime(agentId, prev);
      const next = transform(current);
      if (next === current) return prev;
      const map = new Map(prev);
      map.set(agentId, next);
      return map;
    });
    if (effects && effects.length) {
      const send = handlersRef.current.onEffect;
      for (const effect of effects) send(agentId, effect);
    }
  }, [ensureRuntime]);

  const dispatch = useCallback((frame: WsIncoming) => {
    const agentId = (frame as { agentId?: string }).agentId;
    if (!agentId) {
      // Frames without an agentId (safety_ask / safety_ask_resolved /
      // fact_changed) still need to surface as effects. Fan them out by
      // replaying through every known runtime so the host can react via the
      // effect channel; reducer remains a no-op for them.
      setRuntimes((prev) => {
        if (prev.size === 0) {
          handlersRef.current.onEffect('', { type: stableEffectType(frame), payload: frame });
          return prev;
        }
        for (const [id, rt] of prev) {
          const { effects } = applyEvent(rt, frame);
          for (const effect of effects) handlersRef.current.onEffect(id, effect);
        }
        return prev;
      });
      return;
    }

    setRuntimes((prev) => {
      const current = ensureRuntime(agentId, prev);
      const { next, effects } = applyEvent(current, frame);
      for (const effect of effects) handlersRef.current.onEffect(agentId, effect);
      if (next === current) return prev;
      const map = new Map(prev);
      map.set(agentId, next);
      return map;
    });
  }, [ensureRuntime]);

  const getRuntime = useCallback((agentId: string): AgentRuntime => {
    return runtimes.get(agentId) ?? createAgentRuntime(agentId);
  }, [runtimes]);

  const forgetAgent = useCallback((agentId: string) => {
    setRuntimes((prev) => {
      if (!prev.has(agentId)) return prev;
      const map = new Map(prev);
      map.delete(agentId);
      return map;
    });
  }, []);

  const appendOptimisticUserMessage = useCallback((agentId: string, message: import('@berry-agent/claw-contracts').ChatMessage) => {
    replaceRuntime(agentId, (rt) => ({ ...rt, messages: [...rt.messages, message] }));
  }, [replaceRuntime]);

  const setActiveSession = useCallback((agentId: string, sessionId: string | undefined, messages?: import('@berry-agent/claw-contracts').ChatMessage[]) => {
    replaceRuntime(agentId, (rt) => ({
      ...rt,
      activeSessionId: sessionId,
      messages: messages ?? rt.messages,
    }));
  }, [replaceRuntime]);

  const setContext = useCallback((agentId: string, tokensUsed: number, window: number | null) => {
    replaceRuntime(agentId, (rt) => ({ ...rt, context: { tokensUsed, window } }));
  }, [replaceRuntime]);

  const setTodos = useCallback((agentId: string, sessionId: string, todos: import('@berry-agent/claw-contracts').TodoItem[]) => {
    replaceRuntime(agentId, (rt) => ({
      ...rt,
      todosBySession: { ...rt.todosBySession, [sessionId]: todos },
    }));
  }, [replaceRuntime]);

  const setCreatingSession = useCallback((agentId: string, value: boolean) => {
    replaceRuntime(agentId, (rt) => (rt.creatingSession === value ? rt : { ...rt, creatingSession: value }));
  }, [replaceRuntime]);

  const resetForAgentSwitch = useCallback((agentId: string) => {
    // Switching tabs should not nuke streaming for that agent — that is the
    // entire reason this hook exists. Just ensure the runtime is materialised.
    replaceRuntime(agentId, (rt) => rt);
  }, [replaceRuntime]);

  return useMemo(() => ({
    getRuntime,
    dispatch,
    forgetAgent,
    appendOptimisticUserMessage,
    setActiveSession,
    setContext,
    setTodos,
    setCreatingSession,
    resetForAgentSwitch,
    runtimes,
  }), [
    getRuntime,
    dispatch,
    forgetAgent,
    appendOptimisticUserMessage,
    setActiveSession,
    setContext,
    setTodos,
    setCreatingSession,
    resetForAgentSwitch,
    runtimes,
  ]);
}

/**
 * Effect type tag for frames that can arrive without an agentId. Keeps the
 * effect router in {@link AgentRuntimeHandlers} symmetrical with the
 * agent-scoped path.
 */
function stableEffectType(frame: WsIncoming): RuntimeEffect['type'] {
  switch (frame.type) {
    case 'fact_changed':
      return 'fact-changed';
    case 'safety_ask':
      return 'safety-ask';
    case 'safety_ask_resolved':
      return 'safety-ask-resolved';
    default:
      return 'error';
  }
}

// Internal use only — `useEffect` is imported just to keep the build cleaner
// for downstream files that might want to refresh refs.
export const __useEffect = useEffect;
