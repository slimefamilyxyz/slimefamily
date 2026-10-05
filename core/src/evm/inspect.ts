import { decodeFunctionData, parseAbi, type Hex } from 'viem';

/**
 * What a KyberSwap-built swap may do before a slime signs it: the transaction goes to KyberSwap's router (the same
 * address on every chain), calls its swap, and its swap description is exactly the trade we asked for: our input
 * token and amount, our output token, the slime's own wallet as the receiver, a minimum return no worse than the
 * quote less slippage, and no fee receiver but the treasury. Native coin is attached only when native goes in.
 * The approval that precedes it is for exactly the amount, to the router only.
 */
export const KYBER_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
export const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const ROUTER_ABI = parseAbi([
  'struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }',
  'function swap(SwapExecutionParams execution) payable returns (uint256, uint256)',
  'function swapSimpleMode(address caller, SwapDescriptionV2 desc, bytes executorData, bytes clientData) returns (uint256, uint256)',
]);
export { ROUTER_ABI };

export interface SwapIntent {
  wallet: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  /** The quote's output: the signed minimum may not be below it less `slippageBps` (plus a hair for rounding). */
  quotedOut: bigint;
  slippageBps: number;
  /** The treasury, the only fee receiver allowed (none when null). */
  feeReceiver: string | null;
}

export class UnsafeEvmTransaction extends Error {
  constructor(reason: string) {
    super(`refused to sign: ${reason}`);
    this.name = 'UnsafeEvmTransaction';
  }
}

const lc = (a: string) => a.toLowerCase();

export function inspectEvmSwap(tx: { to: string; data: string; value: bigint }, want: SwapIntent): void {
  if (lc(tx.to) !== KYBER_ROUTER) throw new UnsafeEvmTransaction(`it goes to ${tx.to}, not KyberSwap's router`);
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: ROUTER_ABI, data: tx.data as Hex });
  } catch {
    throw new UnsafeEvmTransaction('it is not a KyberSwap swap call');
  }
  const desc = decoded.functionName === 'swap' ? decoded.args[0].desc : decoded.args[1];
  const nativeIn = lc(want.tokenIn) === NATIVE_TOKEN;
  if (lc(desc.srcToken) !== lc(want.tokenIn)) throw new UnsafeEvmTransaction(`it spends ${desc.srcToken}, not ${want.tokenIn}`);
  if (lc(desc.dstToken) !== lc(want.tokenOut)) throw new UnsafeEvmTransaction(`it buys ${desc.dstToken}, not ${want.tokenOut}`);
  if (lc(desc.dstReceiver) !== lc(want.wallet)) throw new UnsafeEvmTransaction(`the output goes to ${desc.dstReceiver}, not the slime's wallet`);
  if (desc.amount !== want.amountIn) throw new UnsafeEvmTransaction(`it spends ${desc.amount}, not ${want.amountIn}`);
  const floor = (want.quotedOut * BigInt(10_000 - want.slippageBps - 5)) / 10_000n;
  if (desc.minReturnAmount < floor) throw new UnsafeEvmTransaction(`its minimum return ${desc.minReturnAmount} is below the quote less slippage`);
  for (const r of desc.feeReceivers) {
    if (!want.feeReceiver || lc(r) !== lc(want.feeReceiver)) throw new UnsafeEvmTransaction(`it pays a fee to ${r}`);
  }
  if (tx.value !== (nativeIn ? want.amountIn : 0n)) throw new UnsafeEvmTransaction(`it attaches ${tx.value} of the native coin`);
}
