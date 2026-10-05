import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { ataOf, DEFAULT_POLICY, inspectTransaction, PUMPPORTAL_ROUTER, UnsafeTransaction } from '../src/chain/inspect.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const JUPITER = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const wallet = Keypair.generate().publicKey;
const thief = Keypair.generate().publicKey;
const tokenAccount = Keypair.generate().publicKey;

const tx = (instructions: TransactionInstruction[], payer = wallet) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111', instructions }).compileToV0Message());
const tokenIx = (kind: number, keys: PublicKey[], signer = wallet) =>
  new TransactionInstruction({
    programId: TOKEN,
    keys: [...keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })), { pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from([kind, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
const swap = () => new TransactionInstruction({ programId: JUPITER, keys: [{ pubkey: wallet, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3]) });
const refused = (t: VersionedTransaction, policy = DEFAULT_POLICY, signers = [wallet]) => {
  try {
    inspectTransaction(t, signers, policy);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(UnsafeTransaction);
    return (err as Error).message;
  }
};

describe('inspectTransaction', () => {
  it('signs a plain swap with rent and a small tip', () => {
    const t = tx([swap(), SystemProgram.transfer({ fromPubkey: wallet, toPubkey: thief, lamports: 1_000_000 })]);
    expect(refused(t)).toBeNull();
  });

  it('lets SOL go to the wallet\'s own wrapped-SOL account, however much', () => {
    const wsol = new PublicKey(ataOf(wallet, 'So11111111111111111111111111111111111111112'));
    expect(refused(tx([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 50_000_000_000 }), swap()]))).toBeNull();
  });

  it('refuses to send more SOL away than the policy allows', () => {
    expect(refused(tx([swap(), SystemProgram.transfer({ fromPubkey: wallet, toPubkey: thief, lamports: 5_000_000_000 })]))).toMatch(/SOL outside the wallet/);
  });

  it('refuses a transaction someone else pays for or must also sign', () => {
    expect(refused(tx([swap()], thief))).toMatch(/fee payer/);
    const cosigned = new TransactionInstruction({ programId: JUPITER, keys: [{ pubkey: thief, isSigner: true, isWritable: false }], data: Buffer.from([1]) });
    expect(refused(tx([swap(), cosigned]))).toMatch(/needs a signature/);
  });

  it('refuses unknown programs unless this transaction allows them', () => {
    const odd = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: wallet, isSigner: true, isWritable: true }], data: Buffer.from([]) });
    expect(refused(tx([odd]))).toMatch(/unknown program/);
    const router = new TransactionInstruction({ programId: new PublicKey(PUMPPORTAL_ROUTER), keys: [{ pubkey: wallet, isSigner: true, isWritable: true }], data: Buffer.from([]) });
    expect(refused(tx([router]))).toMatch(/unknown program/);
    expect(refused(tx([router]), { ...DEFAULT_POLICY, extraPrograms: [PUMPPORTAL_ROUTER] })).toBeNull();
  });

  it('refuses every way of handing tokens or control away', () => {
    expect(refused(tx([swap(), tokenIx(6, [tokenAccount])]))).toMatch(/SetAuthority/);
    expect(refused(tx([swap(), tokenIx(4, [tokenAccount, thief])]))).toMatch(/Approve/);
    expect(refused(tx([swap(), tokenIx(3, [tokenAccount, thief])]))).toMatch(/Transfer/);
    expect(refused(tx([swap(), tokenIx(9, [tokenAccount, thief])]))).toMatch(/closes a token account/);
    expect(refused(tx([swap(), tokenIx(9, [tokenAccount, wallet])]))).toBeNull();
    expect(refused(tx([SystemProgram.assign({ accountPubkey: wallet, programId: thief })]))).toMatch(/reassign/);
  });

  it('refuses a burn and any top-level token instruction a swap does not need', () => {
    expect(refused(tx([swap(), tokenIx(8, [tokenAccount, Keypair.generate().publicKey])]))).toMatch(/Burn/);
    expect(refused(tx([swap(), tokenIx(15, [tokenAccount, Keypair.generate().publicKey])]))).toMatch(/BurnChecked/);
    expect(refused(tx([swap(), tokenIx(7, [tokenAccount, thief])]))).toMatch(/instruction 7/); // MintTo
    expect(refused(tx([swap(), tokenIx(17, [tokenAccount])]))).toBeNull(); // SyncNative is fine
  });

  it('caps the priority fee', () => {
    expect(refused(tx([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000_000_000 }), swap()]))).toMatch(/priority fee is 140 SOL/);
    expect(refused(tx([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }), swap()]))).toBeNull(); // 0.0002 SOL
  });
});
