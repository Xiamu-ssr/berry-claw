import { createKeyStore, generateIdentity, loadIdentity, privateKeyPem, signNonce, verifyIdentity } from '../auth/keystore.js';
import { ConfigManager } from '../engine/config-manager.js';

export async function runKey(args: string[]): Promise<boolean> {
  const [cmd, ...rest] = args;
  const config = new ConfigManager();
  const store = createKeyStore(config.appDir);

  switch (cmd) {
    case 'gen': {
      const identity = generateIdentity(store);
      printIdentity(identity);
      return true;
    }
    case 'reset': {
      const force = rest.includes('--force');
      if (!force && !process.stdin.isTTY) {
        console.error('key reset overwrites instance.key; pass --force in non-interactive shells');
        return false;
      }
      if (!force) {
        process.stdout.write('This will revoke existing clients. Continue? [y/N] ');
        const answer = await readStdinLine();
        if (!/^y(es)?$/i.test(answer.trim())) return false;
      }
      const identity = generateIdentity(store, { overwrite: true });
      printIdentity(identity);
      return true;
    }
    case 'show': {
      const identity = loadIdentity(store);
      printIdentity(identity);
      console.log('');
      console.log(`Endpoint:     http://${identity.hostname}:3210`);
      console.log('');
      console.log('Private Key (paste into Electron):');
      console.log(privateKeyPem(store).trim());
      return true;
    }
    case 'verify': {
      const result = verifyIdentity(store);
      if (!result.ok) {
        console.error(`Key verification failed: ${result.reason}`);
        return false;
      }
      console.log('Key verification OK');
      if (result.identity) printIdentity(result.identity);
      return true;
    }
    case 'sign': {
      const nonce = rest[0];
      if (!nonce) {
        console.error('Usage: berry-claw key sign <nonce>');
        return false;
      }
      console.log(signNonce(store, nonce));
      return true;
    }
    default:
      console.log(`Usage:
  berry-claw key gen
  berry-claw key reset [--force]
  berry-claw key show
  berry-claw key verify
  berry-claw key sign <nonce>`);
      return false;
  }
}

function printIdentity(identity: { instanceId: string; hostname: string; keyFingerprint: string; publicKey: string }): void {
  console.log(`Instance ID:  ${identity.instanceId}`);
  console.log(`Hostname:     ${identity.hostname}`);
  console.log(`Fingerprint:  ${identity.keyFingerprint}`);
  console.log(`Public Key:   ${identity.publicKey}`);
}

function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.resume();
    process.stdin.once('data', (chunk) => {
      data += chunk;
      process.stdin.pause();
      resolve(data);
    });
  });
}
