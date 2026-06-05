/**
 * ClawServices — the BFF's shared handles, passed to every route module.
 *
 * This is deliberately NOT a manager: it holds no agent state and contains no
 * orchestration logic. It is just the four things a route needs — the a8s
 * client (the only door to agents/sessions/models), the BFF-local config, the
 * outbound FactBus, and the observe collector. Routes map HTTP ⇄ a8s client
 * calls directly; there is no central god-object between them.
 */

import type { A8sClient } from '@berry-agent/client';
import type { Observer } from '@berry-agent/observe';
import type { ClawConfig } from './claw-config.js';
import type { FactBus } from '../facts/bus.js';

export interface ClawServices {
  config: ClawConfig;
  client: A8sClient;
  facts: FactBus;
  observer: Observer;
}
