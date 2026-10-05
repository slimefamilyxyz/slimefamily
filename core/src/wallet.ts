import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAINS, type ChainId } from './chains.js';

export interface NewWallet {
  address: string;
  secretEnc: string;
}

function masterKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('WALLET_MASTER_KEY must be 32 bytes of hex (openssl rand -hex 32)');
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM, bound to the wallet address so a ciphertext cannot be swapped onto another agent. */
export function encryptSecret(secret: Uint8Array, address: string, masterHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(masterHex), iv);
  cipher.setAAD(Buffer.from(address));
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(enc: string, address: string, masterHex: string): Uint8Array {
  const [version, iv, tag, ct] = enc.split(':');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('unknown wallet ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(masterHex), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(address));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]));
}

/** A fresh Solana keypair; the 64-byte secret is the format Phantom and solana-keygen import. */
export function createWallet(masterHex: string): NewWallet {
  const kp = nacl.sign.keyPair();
  const address = bs58.encode(kp.publicKey);
  return { address, secretEnc: encryptSecret(kp.secretKey, address, masterHex) };
}

/** A fresh EVM key: one address serves every EVM chain; stored lower-cased, like every EVM address here. */
export function createEvmWallet(masterHex: string): NewWallet {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address.toLowerCase();
  return { address, secretEnc: encryptSecret(Buffer.from(key.slice(2), 'hex'), address, masterHex) };
}

/** The wallet a new slime gets on its chain. */
export function walletFor(chain: ChainId, masterHex: string): NewWallet {
  return CHAINS[chain].kind === 'evm' ? createEvmWallet(masterHex) : createWallet(masterHex);
}

export function exportSecretBase58(enc: string, address: string, masterHex: string): string {
  return bs58.encode(decryptSecret(enc, address, masterHex));
}

/** The key in the form its chain's wallets import: base58 for Phantom, 0x hex for MetaMask and Rabby. */
export function exportSecret(chain: ChainId, enc: string, address: string, masterHex: string): string {
  return CHAINS[chain].kind === 'evm' ? `0x${Buffer.from(decryptSecret(enc, address, masterHex)).toString('hex')}` : exportSecretBase58(enc, address, masterHex);
}

// Owner keys: shown once, stored only as a hash.
export const OWNER_KEY_PREFIX = 'slime_owner_';

export function newOwnerKey(): string {
  return OWNER_KEY_PREFIX + bs58.encode(randomBytes(24));
}

export function hashOwnerKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
