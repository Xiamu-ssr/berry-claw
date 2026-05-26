/**
 * MCP config loader — unit tests for the 3-layer cascade semantics.
 *
 * These tests lock in the two invariants the refactor fixed:
 *   1. `shared` is resolved POST-merge based on whichever layer contributed
 *      the final entry; a lower layer that only tweaks `env` must not wipe
 *      a higher layer's explicit `shared:true`.
 *   2. The result carries `layer`, pointing at the top-most contributing layer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMCPLayer,
  loadMergedMCPConfig,
  mergeMCPConfigs,
  type MCPServerConfig,
} from '../engine/mcp-config.js';
import { MCP_CONFIG_FILENAME } from '@berry-agent/mcp';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'berry-mcp-cfg-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeLayer(dir: string, body: object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MCP_CONFIG_FILENAME), JSON.stringify(body), 'utf-8');
}

describe('loadMCPLayer — defaults per layer', () => {
  it('global layer defaults shared=true', () => {
    writeLayer(join(root, 'g'), {
      mcpServers: { foo: { command: 'echo' } },
    });
    const loaded = loadMCPLayer(join(root, 'g', MCP_CONFIG_FILENAME), 'global');
    expect(loaded.foo.shared).toBe(true);
    expect(loaded.foo.layer).toBe('global');
    // When the user didn't write a prefix we leave it undefined so the MCP
    // adapter can auto-detect against the live tool list at connect time.
    expect(loaded.foo.prefix).toBeUndefined();
    expect(loaded.foo.enabled).toBe(true);
  });

  it('preserves an explicit empty prefix as opt-out (not default)', () => {
    writeLayer(join(root, 'g'), {
      mcpServers: { foo: { command: 'echo', prefix: '' } },
    });
    const loaded = loadMCPLayer(join(root, 'g', MCP_CONFIG_FILENAME), 'global');
    expect(loaded.foo.prefix).toBe('');
  });

  it('preserves an explicit custom prefix verbatim', () => {
    writeLayer(join(root, 'g'), {
      mcpServers: { foo: { command: 'echo', prefix: 'custom_' } },
    });
    const loaded = loadMCPLayer(join(root, 'g', MCP_CONFIG_FILENAME), 'global');
    expect(loaded.foo.prefix).toBe('custom_');
  });

  it('agent layer defaults shared=false', () => {
    writeLayer(join(root, 'a'), {
      mcpServers: { foo: { command: 'echo' } },
    });
    const loaded = loadMCPLayer(join(root, 'a', MCP_CONFIG_FILENAME), 'agent');
    expect(loaded.foo.shared).toBe(false);
    expect(loaded.foo.layer).toBe('agent');
  });

  it('project layer defaults shared=false', () => {
    writeLayer(join(root, 'p'), {
      mcpServers: { foo: { command: 'echo' } },
    });
    const loaded = loadMCPLayer(join(root, 'p', MCP_CONFIG_FILENAME), 'project');
    expect(loaded.foo.shared).toBe(false);
    expect(loaded.foo.layer).toBe('project');
  });
});

describe('loadMergedMCPConfig — three-state shared merge', () => {
  it('preserves global shared=true when lower layer only tweaks env', () => {
    // Regression: before the refactor, project's normalized shared=false
    // (the layer default) wiped global's explicit shared=true during merge.
    writeLayer(join(root, 'g'), {
      mcpServers: {
        tavily: {
          type: 'http',
          url: 'https://api.tavily.com/search',
          shared: true,
          headers: { 'X-Foo': 'base' },
        },
      },
    });
    writeLayer(join(root, 'p'), {
      mcpServers: {
        tavily: {
          type: 'http',
          url: 'https://api.tavily.com/search',
          headers: { 'X-Bar': 'over' }, // only env tweak, no shared override
        },
      },
    });

    const merged = loadMergedMCPConfig({
      globalPath: join(root, 'g', MCP_CONFIG_FILENAME),
      projectPath: join(root, 'p', MCP_CONFIG_FILENAME),
      agentPath: join(root, 'agent-does-not-exist', MCP_CONFIG_FILENAME),
    });

    expect(merged.tavily.shared).toBe(true);
    expect(merged.tavily.layer).toBe('project'); // top-most contributing layer
    if (merged.tavily.transport.type !== 'http') throw new Error('expected http transport');
    expect(merged.tavily.transport.headers).toEqual({ 'X-Foo': 'base', 'X-Bar': 'over' });
  });

  it('allows lower layer to explicitly override shared=false', () => {
    writeLayer(join(root, 'g'), {
      mcpServers: { foo: { command: 'echo', shared: true } },
    });
    writeLayer(join(root, 'a'), {
      mcpServers: { foo: { command: 'echo', shared: false } },
    });

    const merged = loadMergedMCPConfig({
      globalPath: join(root, 'g', MCP_CONFIG_FILENAME),
      agentPath: join(root, 'a', MCP_CONFIG_FILENAME),
    });

    expect(merged.foo.shared).toBe(false);
    expect(merged.foo.layer).toBe('agent');
  });

  it('single-layer global entry without explicit shared resolves to true', () => {
    writeLayer(join(root, 'g'), {
      mcpServers: { foo: { command: 'echo' } },
    });
    const merged = loadMergedMCPConfig({
      globalPath: join(root, 'g', MCP_CONFIG_FILENAME),
      agentPath: join(root, 'noagent', MCP_CONFIG_FILENAME),
    });
    expect(merged.foo.shared).toBe(true);
    expect(merged.foo.layer).toBe('global');
  });
});

describe('mergeMCPConfigs — pre-resolved inputs round-trip', () => {
  it('treats resolved shared values as explicit', () => {
    // When callers pass already-resolved layers (with `shared` populated),
    // the merger must honor every explicit value.
    const globalLayer: Record<string, MCPServerConfig> = {
      foo: {
        transport: { type: 'stdio', command: 'echo' },
        shared: true,
        prefix: undefined,
        enabled: true,
        layer: 'global',
      },
    };
    const agentLayer: Record<string, MCPServerConfig> = {
      foo: {
        transport: { type: 'stdio', command: 'echo', args: ['-n'] },
        shared: false,
        prefix: undefined,
        enabled: true,
        layer: 'agent',
      },
    };
    const merged = mergeMCPConfigs([globalLayer, agentLayer]);
    expect(merged.foo.shared).toBe(false);
    expect(merged.foo.layer).toBe('agent');
    if (merged.foo.transport.type !== 'stdio') throw new Error('expected stdio');
    expect(merged.foo.transport.args).toEqual(['-n']);
  });
});
