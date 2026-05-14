import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const env = { ...process.env };
const keyPath = join(homedir(), '.berry-claw', 'instance.key');

if (!env.VITE_DEV_PRIVATE_KEY_B64 && existsSync(keyPath)) {
  const pem = readFileSync(keyPath, 'utf8').trim();
  if (pem) {
    env.VITE_DEV_PRIVATE_KEY_B64 = Buffer.from(pem, 'utf8').toString('base64');
  }
}

const child = spawn('vite', process.argv.slice(2), {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
