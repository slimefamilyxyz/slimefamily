import { encodeFunctionData, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { CHAINS } from '../src/chains.js';
import { inspectEvmSwap, KYBER_ROUTER, NATIVE_TOKEN, ROUTER_ABI, UnsafeEvmTransaction, type SwapIntent } from '../src/evm/inspect.js';

// The EVM transaction checks, from the platform's evm.test.ts (its other tests need the platform's database).

const USDC = CHAINS.base.stable.mint;
const TOKEN = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed';
const TREASURY = '0x1be48e6e496ceb5a3d2a081d7cec9590f2301bec';
const wallet = '0x2222222222222222222222222222222222222222';
const thief = '0x3333333333333333333333333333333333333333';

function swapData(o: { src: string; dst: string; to: string; amount: bigint; min: bigint; fee?: string }): string {
  const desc = {
    srcToken: o.src as Hex,
    dstToken: o.dst as Hex,
    srcReceivers: [],
    srcAmounts: [],
    feeReceivers: o.fee ? [o.fee as Hex] : [],
    feeAmounts: o.fee ? [20n] : [],
    dstReceiver: o.to as Hex,
    amount: o.amount,
    minReturnAmount: o.min,
    flags: 0n,
    permit: '0x' as Hex,
  };
  return encodeFunctionData({ abi: ROUTER_ABI, functionName: 'swap', args: [{ callTarget: thief as Hex, approveTarget: thief as Hex, targetData: '0x', desc, clientData: '0x' }] });
}

describe('inspectEvmSwap', () => {
  const want: SwapIntent = { wallet, tokenIn: USDC, tokenOut: TOKEN, amountIn: 5_000_000n, quotedOut: 1000n, slippageBps: 100, feeReceiver: TREASURY };
  const ok = { src: USDC, dst: TOKEN, to: wallet, amount: 5_000_000n, min: 990n, fee: TREASURY };
  const check = (tx: { to?: string; data?: string; value?: bigint }, w = want) => {
    try {
      inspectEvmSwap({ to: KYBER_ROUTER, data: swapData(ok), value: 0n, ...tx }, w);
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeEvmTransaction);
      return (err as Error).message;
    }
  };

  it('signs exactly the trade it asked for', () => expect(check({})).toBeNull());
  it('refuses another contract, another receiver, another token or amount', () => {
    expect(check({ to: thief })).toMatch(/not KyberSwap's router/);
    expect(check({ data: swapData({ ...ok, to: thief }) })).toMatch(/output goes to/);
    expect(check({ data: swapData({ ...ok, dst: thief }) })).toMatch(/buys/);
    expect(check({ data: swapData({ ...ok, amount: 6_000_000n }) })).toMatch(/spends 6000000/);
    expect(check({ data: '0xa9059cbb' + '0'.repeat(128) })).toMatch(/not a KyberSwap swap/);
  });
  it('refuses a minimum return below the quote less slippage, a stranger fee, and attached native coin', () => {
    expect(check({ data: swapData({ ...ok, min: 900n }) })).toMatch(/minimum return/);
    expect(check({ data: swapData({ ...ok, fee: thief }) })).toMatch(/fee to/);
    expect(check({}, { ...want, feeReceiver: null })).toMatch(/fee to/);
    expect(check({ value: 1n })).toMatch(/attaches/);
    const nativeIn = { ...want, tokenIn: NATIVE_TOKEN, feeReceiver: null };
    expect(check({ data: swapData({ ...ok, src: NATIVE_TOKEN, fee: undefined }), value: 5_000_000n }, nativeIn)).toBeNull();
  });
});
