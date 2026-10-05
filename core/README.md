# Slime Family core: the money path, in the open

The platform is private. This folder is the part that decides what happens to money, published so anyone can check it:
how slimes' wallet keys are stored, what every transaction must pass before a slime's key signs it, the limits every
trade goes through, and where withdrawals can go. Every file in `src/` and the tests are **copied unchanged** from the
platform (private commit `da98f9a`, 5 October 2026) and run here on their own.

```bash
cd core && npm install && npm test        # 39 tests: transaction checks, limits, exits, ledger, key encryption
```

## What to read

| File | What it guarantees |
|---|---|
| [`src/wallet.ts`](src/wallet.ts) | Every slime gets its own wallet. Its key is encrypted with AES-256-GCM under a master key that lives only on the server, and **bound to the wallet's address** (the address is the authenticated data): a ciphertext moved onto another slime does not decrypt. Owner keys are shown once and stored only as a SHA-256 hash, compared in constant time. |
| [`src/chain/inspect.ts`](src/chain/inspect.ts) | **Before a slime's key signs anything on Solana**, the transaction is decoded and checked: the slime's wallet pays the fee and only the keys it means to sign with may be required; top-level calls go only to an allow-list (System, Compute Budget, SPL Token, Token-2022, Associated Token Account, Memo, Jupiter v6, pump.fun and its AMM and fee programs, Metaplex metadata); top-level token instructions are limited to opening accounts, syncing wrapped SOL and closing an account **to the wallet itself** (transfers, approvals, `SetAuthority`, burns are refused); System `Assign`/`Allocate`, which could take over the wallet, are refused; priority fees are capped at 0.01 SOL and SOL leaving to other accounts at 0.02 SOL. Anything else throws `UnsafeTransaction` and nothing is signed. What an allowed program does inside (the AMMs a Jupiter route passes through) is that program's; the fill is read back from the chain afterwards. |
| [`src/evm/inspect.ts`](src/evm/inspect.ts) | The same on Base, BNB Chain and Robinhood Chain: the transaction must go to KyberSwap's router and decode as its swap; it must spend exactly the token and amount asked, buy exactly the token asked, deliver **to the slime's own wallet**, with a minimum return no worse than the quote less the slippage limit, pay fees to no one but the treasury, and attach native coin only when native coin is what goes in. |
| [`src/engine/limits.ts`](src/engine/limits.ts), [`src/engine/settings.ts`](src/engine/settings.ts) | Hard limits the AI cannot talk its way past: platform liquidity floor, owner's minimum liquidity, token age, max position size, max open positions, daily buy limit, max price impact. The server shrinks or refuses a trade outside them, whatever the brain decides. |
| [`src/engine/exits.ts`](src/engine/exits.ts), [`src/engine/ledger.ts`](src/engine/ledger.ts) | Stop loss, take profit and trailing stop, checked on every price move (they run even when the AI is asleep or out of budget), and the position accounting behind P&L. |
| [`src/engine/executor.ts`](src/engine/executor.ts) | Before a buy, the server quotes selling the tokens straight back; no route, or less than 80% coming back, and the buy is refused: no honeypots. |
| [`excerpts/withdraw-route.ts`](excerpts/withdraw-route.ts) | The only route that moves a live slime's money out: the destination is **always the owner's signature-linked wallet**, never an address from the request. A stolen owner key cannot send money anywhere else. (Excerpt, not compiled here.) |

## What you can check on chain without any code

Every live slime's wallet address is on its page; every trade links to its transaction; withdrawals go only to the
owner's linked wallet; the launchpad's 95/5 creator-fee split is a pump.fun fee-sharing config, readable and immutable.

Found a problem? Open a private security advisory on this repository.
