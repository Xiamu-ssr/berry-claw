export function modelShortName(model?: string): string {
  if (!model) return '-';
  return model.split('/').pop()?.split(':').pop() ?? model;
}

/**
 * Wire-protocol family of a model id. Mirrors the SDK's modelProtocolFamily
 * (packages/models/src/protocol.ts) — kept as a tiny local copy because the
 * SDK models package is Node-oriented and we don't want it in the browser
 * bundle. Claude family → 'anthropic', everything else → 'openai'. Used by the
 * ModelPicker family-lock so an agent can't be switched across protocol
 * families mid-life (which would break anthropic prompt caching).
 */
const ANTHROPIC_FAMILY = /(?:^|[/\-_:])(?:claude|opus|sonnet|haiku)(?:$|[/\-_:.\d])/i;
export function modelFamily(modelId?: string): 'anthropic' | 'openai' | undefined {
  if (!modelId) return undefined;
  // tier:X aliases carry no family — resolved server-side per worker.
  if (modelId.startsWith('tier:')) return undefined;
  return ANTHROPIC_FAMILY.test(modelId) ? 'anthropic' : 'openai';
}

export function shortSessionId(id?: string): string {
  if (!id) return '';
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value && value.trim().length > 0))];
}

export function formatSessionTime(value?: number): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function lastPathPart(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean;
}

export function genId(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
