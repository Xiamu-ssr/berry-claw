/**
 * FactBus — the single outbound stream of truth for the UI.
 *
 * All state mutations in AgentManager, TeamStore, and SessionStore funnel
 * fact_changed events through this bus. The server WS layer subscribes and
 * relays verbatim. The frontend subscribes and merges fact snapshots into
 * its read model. No other sync channel is allowed.
 *
 * Why one bus:
 * - Before: 5+ WS event types (config_changed, status_change, session_*,
 *   agent.*, team.*) with ad-hoc payloads. Frontend had to pattern-match
 *   each and re-fetch to resolve references. Bugs like "model-switched
 *   from chat page but agents page still stale" came from that sprawl.
 * - After: one event, one payload shape. Frontend dispatches by `kind`
 *   and patches its cache by `id`. That's the whole protocol.
 */

import { EventEmitter } from 'node:events';
import type { FactChange, AgentFact, TeamFact, SessionFact } from './types.js';

export type FactListener = (change: FactChange) => void;

export class FactBus {
  private readonly emitter = new EventEmitter();

  /** Subscribe; returns an unsubscribe function. */
  on(listener: FactListener): () => void {
    this.emitter.on('fact_changed', listener);
    return () => this.emitter.off('fact_changed', listener);
  }

  /** Low-level emit. Prefer the typed helpers below. */
  emit(change: FactChange): void {
    this.emitter.emit('fact_changed', change);
  }

  emitAgent(id: string, fact: AgentFact | null): void {
    this.emit({ kind: 'agent', id, fact });
  }

  emitTeam(id: string, fact: TeamFact | null): void {
    this.emit({ kind: 'team', id, fact });
  }

  emitSession(id: string, fact: SessionFact | null): void {
    this.emit({ kind: 'session', id, fact });
  }

  /** Max listeners bump — WS server + optional observers may attach. */
  constructor(maxListeners = 50) {
    this.emitter.setMaxListeners(maxListeners);
  }
}
