/**
 * Safety — three-tier tool-guard mode with agent > project > global cascade.
 *
 * Modes
 * -----
 *   trust   Lightly guarded. Only the absolute-floor denylist (e.g.
 *           `rm -rf /`, DROP DATABASE). No write-scope restriction. No HITL.
 *           Power-user mode — use only on trusted agents in sandboxed roots.
 *   default Standard berry-claw safety. writeScopeGuard (write ops stay
 *           inside scope.writableRoots) + broad destructive denylist.
 *           What we shipped originally.
 *   auto    default + HITL approval on every call of a configurable list
 *           of "dangerous" tools (see {@link DEFAULT_HITL_TOOLS}). Uses
 *           the {@link askList} primitive; a host-supplied {@link AskBridge}
 *           actually pauses the agent and collects the human's answer.
 *           If no bridge is installed the guard fails-closed (denies the
 *           listed tools) — never silently auto-approves.
 *
 * Cascade
 * -------
 * `resolveSafetyLevel(agentEntry, projectRoot, appConfig)` reads in order:
 *   1. agentEntry.safetyLevel                        (highest priority)
 *   2. <projectRoot>/.berry/safety.json `{ level }`
 *   3. appConfig.safetyLevel
 *   4. 'default'                                     (floor)
 *
 * The project-level file is sync-read on each resolve. The file is tiny
 * (one field) and only touched at agent init / reload, so file IO isn't
 * a hot path. Parse errors don't throw — we log and fall through to the
 * next layer so a typo'd JSON file can't wedge every agent on the project.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  compositeGuard,
  denyList,
  writeScopeGuard,
  askList,
  type AskBridge,
} from '@berry-agent/safe';
import type { ToolGuard, AgentScope } from '@berry-agent/core';
import type { AgentEntry, AppConfig } from './config-manager.js';

/** Three safety presets, ordered from most permissive to most cautious. */
export const SAFETY_LEVELS = ['trust', 'default', 'auto'] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

/** Absolute-floor denylist — applied in every mode, even `trust`. These
 *  are commands that are almost certainly unintentional from an agent. */
const CATASTROPHIC_PATTERNS = ['rm -rf /', 'rm -rf ~', 'DROP DATABASE'] as const;

/** Additional denies applied in `default` and `auto` (not in `trust`). */
const DEFAULT_DANGEROUS_PATTERNS = ['DROP TABLE'] as const;

/**
 * Tool names that trigger HITL approval when mode is `auto`. Tuned for
 * berry-claw's built-in toolset: shell execution, file writes, and web
 * fetches are the three surfaces where an unreviewed agent call has
 * visible side effects outside the sandbox. MCP tools are opted-in via
 * extra entries on the HITL list (configured per-agent in the future).
 */
export const DEFAULT_HITL_TOOLS = [
  'shell',
  'write_file',
  'edit_file',
  'web_fetch',
] as const;

/** Project-level safety config file — sibling of team.json under .berry/. */
export const PROJECT_SAFETY_FILENAME = 'safety.json';

export interface ProjectSafetyConfig {
  level?: SafetyLevel;
}

/** Path to the project-level config (without existence check). */
export function projectSafetyPath(projectRoot: string): string {
  return join(projectRoot, '.berry', PROJECT_SAFETY_FILENAME);
}

/**
 * Read `{projectRoot}/.berry/safety.json` synchronously. Returns `null`
 * when the file doesn't exist. Parse errors log a warning and return
 * null — the resolver treats that as "layer not configured" and falls
 * through to the next.
 */
export function readProjectSafety(projectRoot: string): ProjectSafetyConfig | null {
  const path = projectSafetyPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as ProjectSafetyConfig;
    return parsed;
  } catch (err) {
    console.warn(
      `[safety] failed to parse ${path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Write `{projectRoot}/.berry/safety.json` with the given level. Creates
 * the `.berry/` directory if needed. Pass `null` to remove the setting
 * entirely (falls through to global layer).
 */
export function writeProjectSafety(projectRoot: string, level: SafetyLevel | null): void {
  const path = projectSafetyPath(projectRoot);
  if (level === null) {
    // Write an empty object rather than deleting the file, so that if
    // other project-level knobs accrete here later they aren't clobbered.
    writeFileSync(path, JSON.stringify({}, null, 2), 'utf-8');
    return;
  }
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readProjectSafety(projectRoot) ?? {};
  writeFileSync(path, JSON.stringify({ ...existing, level }, null, 2), 'utf-8');
}

/** Narrow a possibly-arbitrary string into a {@link SafetyLevel}, or null. */
export function asSafetyLevel(value: unknown): SafetyLevel | null {
  if (typeof value !== 'string') return null;
  return (SAFETY_LEVELS as readonly string[]).includes(value)
    ? (value as SafetyLevel)
    : null;
}

/**
 * Resolve the effective safety level for an agent. Cascade:
 *   agent > project > global > 'default'.
 *
 * Each layer is inspected only if the prior one returned null/invalid —
 * invalid values at any layer are skipped (with a warn) rather than
 * aborting the cascade. This matches how the rest of the config system
 * behaves around partial / corrupt files.
 */
export function resolveSafetyLevel(
  agentEntry: AgentEntry,
  projectRoot: string | undefined,
  appConfig: { safetyLevel?: SafetyLevel },
): SafetyLevel {
  // 1) Agent override — highest priority.
  const agentLevel = asSafetyLevel(agentEntry.safetyLevel);
  if (agentLevel) return agentLevel;

  // 2) Project-level file (only if the agent is bound to a project).
  if (projectRoot) {
    const project = readProjectSafety(projectRoot);
    const projectLevel = asSafetyLevel(project?.level);
    if (projectLevel) return projectLevel;
  }

  // 3) Global (app-wide) config.
  const globalLevel = asSafetyLevel(appConfig.safetyLevel);
  if (globalLevel) return globalLevel;

  // 4) Floor.
  return 'default';
}

export interface BuildToolGuardOptions {
  /** AgentScope used to construct writeScopeGuard. Required for all modes
   *  except `trust`; kept required everywhere so the signature stays stable. */
  scope: AgentScope;
  /** Bridge that pauses the agent and asks a human. Required for `auto` mode
   *  to actually pause; when omitted, `auto` mode denies listed tools by
   *  default (see askList's fail-closed behavior). */
  askBridge?: AskBridge;
  /** Tool names that should go through HITL under `auto` mode. Defaults to
   *  {@link DEFAULT_HITL_TOOLS}. Hosts can extend this to cover their MCP
   *  tools or project-specific high-risk operations. */
  hitlTools?: string[];
  /** Max ms to wait for a human response before auto-denying (default 5 min
   *  — inherited from askList). */
  hitlTimeoutMs?: number;
  /** Agent id — passed through to the askBridge so the UI can route the
   *  approval dialog to the right session. (The AgentScope doesn't carry
   *  the agent id — the SDK sends the full Session on the guard call, so
   *  the bridge can read session.id there instead.) */
  agentId?: string;
}

/**
 * Build the ToolGuard chain for a given safety mode. The returned guard
 * is ready to be passed into `new Agent({ toolGuard })`.
 *
 * Shape per mode:
 *   trust   → denyList(CATASTROPHIC_PATTERNS)
 *   default → compositeGuard(writeScopeGuard, denyList([CATA, DANG]))
 *   auto    → compositeGuard(default, askList(hitlTools))
 *
 * The first guard in a composite that returns 'deny' short-circuits the
 * rest (see @berry-agent/safe/guards/rules.compositeGuard). Order matters:
 * cheap rule checks run before the HITL round-trip.
 */
export function buildToolGuard(
  level: SafetyLevel,
  opts: BuildToolGuardOptions,
): ToolGuard {
  const { scope, askBridge, hitlTools, hitlTimeoutMs } = opts;

  // Shared building blocks — constructed fresh per call so hosts can hold
  // many simultaneous guards without shared mutable state.
  const floorDenies = denyList([...CATASTROPHIC_PATTERNS]);

  if (level === 'trust') {
    // Lightly guarded. We keep the catastrophic denies so that a confused
    // agent still can't `rm -rf /` even in trust mode — that class of
    // bug is an engineer mistake, not a user's intent.
    return floorDenies;
  }

  const write = writeScopeGuard(scope);
  const broadDenies = denyList([...CATASTROPHIC_PATTERNS, ...DEFAULT_DANGEROUS_PATTERNS]);

  if (level === 'default') {
    return compositeGuard(write, broadDenies);
  }

  // auto — HITL stacked on top of default.
  const hitl = askList({
    tools: [...(hitlTools ?? DEFAULT_HITL_TOOLS)],
    ask: askBridge,
    timeoutMs: hitlTimeoutMs,
    reason: 'Human approval required (safety mode: auto)',
  });
  return compositeGuard(write, broadDenies, hitl);
}
