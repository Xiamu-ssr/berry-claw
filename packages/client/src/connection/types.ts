/**
 * Re-export the Instance shape from the shared contracts package so that the
 * client, CLI, and native shells all agree on the same
 * wire-level schema.
 *
 * We keep this tiny file instead of letting every module import from
 * `@berry-agent/claw-contracts` directly so there is exactly one seam to widen when
 * we start layering client-only fields on top (e.g. UI preferences).
 */
export { zInstance, zInstanceList } from '@berry-agent/claw-contracts';
export type { Instance, InstanceList } from '@berry-agent/claw-contracts';
