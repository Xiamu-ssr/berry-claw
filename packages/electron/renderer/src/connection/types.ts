/**
 * Re-export the Instance shape from the shared contracts package so that the
 * renderer, CLI, and (eventually) Electron main process all agree on the same
 * wire-level schema.
 *
 * We keep this tiny file instead of letting every module import from
 * `@berry-claw/contracts` directly so there is exactly one seam to widen when
 * we start layering renderer-only fields on top (e.g. UI preferences).
 */
export { zInstance, zInstanceList } from '@berry-claw/contracts';
export type { Instance, InstanceList } from '@berry-claw/contracts';
