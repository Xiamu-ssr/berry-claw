/**
 * Tool unit tests — verify file/shell/search tools work correctly
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileTools, createShellTool, createSearchTools } from '@berry-agent/tools-common';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'berry-claw-test-'));
  await writeFile(join(tmpDir, 'hello.txt'), 'Hello World\nSecond line');
  await writeFile(join(tmpDir, 'code.ts'), 'const x = 42;\nexport default x;');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('File tools', () => {
  it('read_file reads content', async () => {
    const tools = createFileTools(tmpDir);
    const readFile = tools.find(t => t.definition.name === 'read_file')!;
    const result = await readFile.execute({ path: 'hello.txt' }, { cwd: tmpDir });
    expect(result.content).toContain('Hello World');
    expect(result.isError).toBeUndefined();
  });

  it('read_file returns error for missing file', async () => {
    const tools = createFileTools(tmpDir);
    const readFile = tools.find(t => t.definition.name === 'read_file')!;
    const result = await readFile.execute({ path: 'nonexistent.txt' }, { cwd: tmpDir });
    expect(result.isError).toBe(true);
  });

  it('write_file creates file', async () => {
    const tools = createFileTools(tmpDir);
    const writeTool = tools.find(t => t.definition.name === 'write_file')!;
    const result = await writeTool.execute({ path: 'new.txt', content: 'Created!' }, { cwd: tmpDir });
    expect(result.content).toContain('Written');

    // Verify
    const readFile = tools.find(t => t.definition.name === 'read_file')!;
    const read = await readFile.execute({ path: 'new.txt' }, { cwd: tmpDir });
    expect(read.content).toBe('Created!');
  });

  it('write_file creates nested directories', async () => {
    const tools = createFileTools(tmpDir);
    const writeTool = tools.find(t => t.definition.name === 'write_file')!;
    const result = await writeTool.execute({ path: 'sub/dir/deep.txt', content: 'Deep' }, { cwd: tmpDir });
    expect(result.content).toContain('Written');
  });

  it('list_files shows directory contents', async () => {
    const tools = createFileTools(tmpDir);
    const listTool = tools.find(t => t.definition.name === 'list_files')!;
    const result = await listTool.execute({ path: '.' }, { cwd: tmpDir });
    expect(result.content).toContain('hello.txt');
    expect(result.content).toContain('code.ts');
  });
});

describe('Shell tool', () => {
  it('executes command and returns output', async () => {
    const tool = createShellTool(tmpDir);
    const result = await tool.execute({ command: 'echo "test123"' }, { cwd: tmpDir });
    expect(result.content).toContain('test123');
  });

  it('returns error for failing command', async () => {
    const tool = createShellTool(tmpDir);
    const result = await tool.execute({ command: 'exit 1' }, { cwd: tmpDir });
    expect(result.isError).toBe(true);
  });

  it('respects cwd', async () => {
    const tool = createShellTool(tmpDir);
    const result = await tool.execute({ command: 'ls hello.txt' }, { cwd: tmpDir });
    expect(result.content).toContain('hello.txt');
  });
});

describe('Search tools', () => {
  it('grep finds pattern in files', async () => {
    const tools = createSearchTools(tmpDir);
    const grep = tools.find(t => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'Hello', path: '.' }, { cwd: tmpDir });
    expect(result.content).toContain('Hello World');
  });

  it('grep returns no matches', async () => {
    const tools = createSearchTools(tmpDir);
    const grep = tools.find(t => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'zzzznonexistent', path: '.' }, { cwd: tmpDir });
    expect(result.content).toContain('no matches');
  });

  it('find_files locates files by name', async () => {
    const tools = createSearchTools(tmpDir);
    const find = tools.find(t => t.definition.name === 'find_files')!;
    const result = await find.execute({ pattern: '*.ts', path: '.' }, { cwd: tmpDir });
    expect(result.content).toContain('code.ts');
  });
});
