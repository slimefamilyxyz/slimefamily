import { PublicKey, VersionedTransaction } from '@solana/web3.js';

/**
 * What a transaction built by someone else (Jupiter, PumpPortal) may do before a slime signs it. A compromised or
 * buggy builder must not be able to hand over the wallet, its token accounts or its SOL: the slime pays the fee
 * itself, signs with only the keys it meant to, calls only known programs at the top level, and the instructions
 * that give funds away (authority changes, approvals, direct token transfers, closing an account to someone else,
 * reassigning the wallet) are refused. SOL sent outside the wallet is capped.
 *
 * Programs called through CPI by an allowed program (the AMMs a Jupiter route passes through) are that program's
 * business; the fill is read back from the chain after the swap.
 */
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NATIVE_MINT = 'So11111111111111111111111111111111111111112';

export const ALLOWED_PROGRAMS: Record<string, string> = {
  [SYSTEM_PROGRAM]: 'System',
  ComputeBudget111111111111111111111111111111: 'Compute budget',
  [TOKEN]: 'SPL Token',
  [TOKEN_2022]: 'Token-2022',
  [ATA]: 'Associated token account',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter v6',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'pump.fun AMM',
  pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ: 'pump.fun fees',
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Metaplex metadata',
};

// System: 0 CreateAccount, 2 Transfer, 3 CreateAccountWithSeed, 11 TransferWithSeed move lamports;
// 1 Assign, 8 Allocate, 9 AllocateWithSeed, 10 AssignWithSeed could take over the wallet account itself.
const SYSTEM_FORBIDDEN = new Set([1, 8, 9, 10]);
// SPL Token at the top level: only what a swap needs around itself. 1, 16 and 18 open a token account, 17 syncs
// wrapped SOL, 9 closes an account (to the wallet only). Everything else (transfers, approvals, authority changes,
// burns, mint operations, Token-2022 extensions) is refused: the swap itself runs inside the aggregator's program.
const TOKEN_ALLOWED = new Set([1, 9, 16, 17, 18]);
const TOKEN_NAMES: Record<number, string> = { 3: 'Transfer', 4: 'Approve', 6: 'SetAuthority', 8: 'Burn', 12: 'TransferChecked', 13: 'ApproveChecked', 15: 'BurnChecked' };
const TOKEN_CLOSE = 9;
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
/** The most a transaction may pay in priority fees: price × compute units. Real swaps pay a small fraction of this. */
export const MAX_PRIORITY_LAMPORTS = 10_000_000n; // 0.01 SOL

export interface InspectPolicy {
  /** SOL the transaction may send to accounts other than the wallet and its wrapped-SOL account. */
  maxForeignLamports: bigint;
  /**
   * Programs allowed for this one transaction beyond ALLOWED_PROGRAMS. They get the wallet's signature through CPI,
   * so whatever they do is checked by simulation instead: the wallet may lose at most `maxSpendLamports` of SOL and
   * none of its USDC.
   */
  extraPrograms?: string[];
  maxSpendLamports?: bigint;
}

/** PumpPortal's router: it wraps the pump.fun buy in a launch with a dev buy (seen in its create transactions, 04.10.2026). */
export const PUMPPORTAL_ROUTER = 'FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe';

export const DEFAULT_POLICY: InspectPolicy = { maxForeignLamports: 20_000_000n }; // 0.02 SOL: rent and tips

export class UnsafeTransaction extends Error {
  constructor(reason: string) {
    super(`refused to sign: ${reason}`);
    this.name = 'UnsafeTransaction';
  }
}

export const ataOf = (owner: PublicKey, mint: string, program = TOKEN) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(program).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA))[0].toBase58();

/** Throws UnsafeTransaction when `tx` would do anything the policy doesn't allow; `signers` are the keys we'll sign with, payer first. */
export function inspectTransaction(tx: VersionedTransaction, signers: PublicKey[], policy: InspectPolicy = DEFAULT_POLICY): void {
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const wallet = signers[0]!.toBase58();
  if (keys[0] !== wallet) throw new UnsafeTransaction(`fee payer is ${keys[0]}, not the slime's wallet`);
  const ours = new Set(signers.map((s) => s.toBase58()));
  for (let i = 0; i < msg.header.numRequiredSignatures; i++) {
    if (!ours.has(keys[i]!)) throw new UnsafeTransaction(`it needs a signature from ${keys[i]}`);
  }
  const own = new Set([wallet, ataOf(signers[0]!, NATIVE_MINT)]);
  // An account index past the static keys points into an address lookup table, which can't be read offline: treat it as foreign.
  const account = (i: number) => keys[i] ?? `lookup#${i}`;
  let foreignLamports = 0n;
  let unitLimit: number | null = null;
  let unitPrice = 0n;

  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    if (!program || (!ALLOWED_PROGRAMS[program] && !policy.extraPrograms?.includes(program))) throw new UnsafeTransaction(`it calls an unknown program ${program ?? '(lookup)'}`);
    const data = Buffer.from(ix.data);
    if (program === SYSTEM_PROGRAM) {
      const kind = data.length >= 4 ? data.readUInt32LE(0) : -1;
      if (SYSTEM_FORBIDDEN.has(kind)) throw new UnsafeTransaction(`System instruction ${kind} could reassign an account`);
      let lamports = 0n;
      let to = '';
      if (kind === 2 && data.length >= 12) [lamports, to] = [data.readBigUInt64LE(4), account(ix.accountKeyIndexes[1]!)];
      else if (kind === 0 && data.length >= 12) [lamports, to] = [data.readBigUInt64LE(4), account(ix.accountKeyIndexes[1]!)];
      else if (kind === 11 && data.length >= 12) [lamports, to] = [data.readBigUInt64LE(4), account(ix.accountKeyIndexes[2]!)];
      else if (kind === 3) {
        // CreateAccountWithSeed: base(32) + seed (u64 length + bytes) + lamports.
        const seedLen = Number(data.readBigUInt64LE(36));
        lamports = data.readBigUInt64LE(44 + seedLen);
        to = account(ix.accountKeyIndexes[1]!);
      } else if (kind !== 2 && kind !== 0 && kind !== 11 && kind !== 3 && kind !== 12) {
        // 12 is AdvanceNonceAccount; anything else from System is unexpected in a swap or launch.
        throw new UnsafeTransaction(`unexpected System instruction ${kind}`);
      }
      if (!own.has(to)) foreignLamports += lamports;
    } else if (program === TOKEN || program === TOKEN_2022) {
      const kind = data[0] ?? -1;
      if (!TOKEN_ALLOWED.has(kind)) throw new UnsafeTransaction(`token ${TOKEN_NAMES[kind] ?? `instruction ${kind}`} at the top level`);
      if (kind === TOKEN_CLOSE && account(ix.accountKeyIndexes[1]!) !== wallet) throw new UnsafeTransaction('it closes a token account to someone else');
    } else if (program === COMPUTE_BUDGET) {
      // 2 SetComputeUnitLimit (u32), 3 SetComputeUnitPrice (u64 micro-lamports per unit).
      if (data[0] === 2 && data.length >= 5) unitLimit = data.readUInt32LE(1);
      if (data[0] === 3 && data.length >= 9) unitPrice = data.readBigUInt64LE(1);
    }
  }
  // Without an explicit limit the runtime allows 200k units per instruction, up to 1.4M.
  const units = BigInt(unitLimit ?? Math.min(1_400_000, 200_000 * msg.compiledInstructions.length));
  const priority = (unitPrice * units) / 1_000_000n;
  if (priority > MAX_PRIORITY_LAMPORTS) throw new UnsafeTransaction(`its priority fee is ${Number(priority) / 1e9} SOL (limit ${Number(MAX_PRIORITY_LAMPORTS) / 1e9})`);
  if (foreignLamports > policy.maxForeignLamports) {
    throw new UnsafeTransaction(`it sends ${Number(foreignLamports) / 1e9} SOL outside the wallet (limit ${Number(policy.maxForeignLamports) / 1e9})`);
  }
}
