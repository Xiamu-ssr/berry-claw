/**
 * Pure formatters for the Audit/Usage view. Ported from the a8s console's
 * UsagePage/UsageDrilldown (Arco) so claw's native Audit page renders cost,
 * tokens, model names, share %, and timestamps identically. No React here —
 * unit-tested directly.
 */

/** `$1.2345` under a dollar (4dp), `$12.34` at/above (2dp). */
export function money(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

/** Abbreviate large counts: 1_500_000 → "1.50M", 2_400 → "2.4k". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Strip the provider prefix + trailing date stamp: "anthropic/claude-x-20250101" → "claude-x". */
export function shortModel(model: string): string {
  return model.replace(/^.*\//, '').replace(/-\d{8}$/, '');
}

/** Percentage share, rounded: ≥10% to whole, below to 1dp. Returns the number. */
export function sharePct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

/** Compact UTC timestamp "M/DD HH:MM:SS"; em-dash for null/0. */
export function when(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
