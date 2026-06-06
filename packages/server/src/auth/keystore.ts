import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { InstanceIdentity } from '@berry-agent/claw-contracts/auth';

export interface KeyStorePaths {
  instanceJson: string;
  instanceKey: string;
  authorizedKeys: string;
}

export interface KeyStore {
  appDir: string;
  paths: KeyStorePaths;
}

export function createKeyStore(appDir: string): KeyStore {
  return {
    appDir,
    paths: {
      instanceJson: join(appDir, 'instance.json'),
      instanceKey: join(appDir, 'instance.key'),
      authorizedKeys: join(appDir, 'authorized_keys'),
    },
  };
}

export function hasIdentity(store: KeyStore): boolean {
  return existsSync(store.paths.instanceJson) && existsSync(store.paths.instanceKey);
}

export function generateIdentity(store: KeyStore, opts: { overwrite?: boolean } = {}): InstanceIdentity {
  if (!existsSync(store.appDir)) mkdirSync(store.appDir, { recursive: true });
  if (!opts.overwrite && hasIdentity(store)) {
    throw new Error('instance identity already exists; use `berry-claw key reset` to replace it');
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicOpenSsh = exportOpenSshPublicKey(publicKey, `${userInfo().username}@berry-claw`);
  const fingerprint = fingerprintOpenSshPublicKey(publicOpenSsh);
  const identity: InstanceIdentity = {
    instanceId: nanoid(),
    hostname: hostname(),
    createdAt: Date.now(),
    publicKey: publicOpenSsh,
    keyFingerprint: fingerprint,
  };

  writeFileSync(store.paths.instanceKey, privatePem, { encoding: 'utf-8', mode: 0o600 });
  chmodSync(store.paths.instanceKey, 0o600);
  writeFileSync(store.paths.instanceJson, JSON.stringify(identity, null, 2) + '\n', 'utf-8');
  writeFileSync(store.paths.authorizedKeys, `${fingerprint} ${publicOpenSsh} instance\n`, 'utf-8');
  return identity;
}

export function loadIdentity(store: KeyStore): InstanceIdentity {
  if (!hasIdentity(store)) {
    throw new Error('instance identity not found; run `berry-claw key gen` first');
  }
  return JSON.parse(readFileSync(store.paths.instanceJson, 'utf-8')) as InstanceIdentity;
}

export function loadPrivateKey(store: KeyStore): KeyObject {
  if (!existsSync(store.paths.instanceKey)) {
    throw new Error('instance private key not found; run `berry-claw key gen` first');
  }
  return createPrivateKey(readFileSync(store.paths.instanceKey, 'utf-8'));
}

export function verifyIdentity(store: KeyStore): { ok: boolean; reason?: string; identity?: InstanceIdentity } {
  try {
    const identity = loadIdentity(store);
    const privateKey = loadPrivateKey(store);
    const publicKey = createPublicKey(privateKey);
    const publicOpenSsh = exportOpenSshPublicKey(publicKey, `${userInfo().username}@berry-claw`);
    const fingerprint = fingerprintOpenSshPublicKey(publicOpenSsh);
    if (fingerprint !== identity.keyFingerprint) {
      return { ok: false, reason: `fingerprint mismatch: instance.json=${identity.keyFingerprint}, key=${fingerprint}`, identity };
    }
    if (identity.publicKey.split(/\s+/).slice(0, 2).join(' ') !== publicOpenSsh.split(/\s+/).slice(0, 2).join(' ')) {
      return { ok: false, reason: 'public key mismatch between instance.json and instance.key', identity };
    }
    return { ok: true, identity };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function signNonce(store: KeyStore, nonce: string): string {
  return sign(null, Buffer.from(nonce), loadPrivateKey(store)).toString('base64');
}

export function verifyNonceSignature(publicOpenSsh: string, nonce: string, signatureBase64: string): boolean {
  const publicKey = importOpenSshPublicKey(publicOpenSsh);
  return verify(null, Buffer.from(nonce), publicKey, Buffer.from(signatureBase64, 'base64'));
}

export function fingerprintOpenSshPublicKey(publicOpenSsh: string): string {
  const blob = Buffer.from(publicOpenSsh.trim().split(/\s+/)[1] ?? '', 'base64');
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/g, '')}`;
}

export function privateKeyPem(store: KeyStore): string {
  return readFileSync(store.paths.instanceKey, 'utf-8');
}

function exportOpenSshPublicKey(publicKey: KeyObject, comment: string): string {
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const raw = spki.subarray(spki.length - 32);
  const type = Buffer.from('ssh-ed25519');
  const blob = Buffer.concat([uint32(type.length), type, uint32(raw.length), raw]);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`;
}

function importOpenSshPublicKey(publicOpenSsh: string): KeyObject {
  const [, b64] = publicOpenSsh.trim().split(/\s+/);
  if (!b64) throw new Error('invalid openssh public key');
  const blob = Buffer.from(b64, 'base64');
  let offset = 0;
  const read = (): Buffer => {
    const len = blob.readUInt32BE(offset);
    offset += 4;
    const out = blob.subarray(offset, offset + len);
    offset += len;
    return out;
  };
  const type = read().toString();
  const raw = read();
  if (type !== 'ssh-ed25519' || raw.length !== 32) throw new Error('only ssh-ed25519 public keys are supported');
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw]), type: 'spki', format: 'der' });
}

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}
