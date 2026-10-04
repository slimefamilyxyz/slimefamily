# Security

## Funds

- **Each slime has its own wallet.** Its key is encrypted at rest (AES-256-GCM) and decrypted only for the moment of signing a swap.
- **Withdrawals go only to the owner's linked wallet.** Linking requires a signature from that wallet; a stolen owner key cannot redirect funds.
- **Fresh signatures for the dangerous steps.** Exporting a slime's key or changing its linked wallet takes a signature from the linked wallet made at that moment (a one-time challenge valid for 10 minutes), not an old session. A live slime's key cannot be exported without a linked wallet.
- **Key export** is available to the owner (with the linked wallet), so a slime's funds never depend on the platform staying online.
- **Kill switch.** The operator can stop all live trading, coin launches and payouts at once.

## Trades

- **Nothing is signed blind.** Swaps are built by Jupiter, KyberSwap and PumpPortal; before a slime signs one, the server checks it. On Solana: the slime pays the fee, only its own keys sign, only known programs run, and nothing that hands over the wallet, its token accounts or an approval is allowed; SOL leaving the wallet is capped. On EVM chains: the call is decoded and must go to KyberSwap's router, spend exactly our amount of our token, buy our token, deliver it to the slime's own wallet, and accept no worse than the quote less slippage. Token approvals are for exactly the trade, to the router only.
- A swap whose outcome is unknown is settled from the chain on the next turn, never guessed: the slime waits until the network says what happened.
- The AI proposes, the server disposes: every trade is checked against the owner's limits regardless of what the model answers.
- Before any buy, a sell-back quote must return at least 80% of the amount: tokens that can't be sold are refused.
- **Solana transactions are inspected before signing:** the slime must pay the fee and only the keys we meant to use may sign; only known programs may run at the top level; token instructions are limited to opening accounts, syncing wrapped SOL and closing accounts to the slime itself (no transfers, approvals, burns or authority changes); SOL sent elsewhere is capped at 0.02 and priority fees at 0.01 SOL. Launches routed through PumpPortal's program are simulated first and may spend no USDC.
- **EVM swaps are decoded before signing:** KyberSwap's router only, our input token and exact amount, our output token, the slime as receiver, a minimum return within slippage of the quote, the treasury as the only fee receiver. Approvals are for the exact amount, to the router only.
- Stops run on the server every minute, independent of the AI.

## Accounts

- Wallet login: one signature over a one-time message bound to the site; sessions last 7 days and are stored only as hashes.
- Owner keys are shown once and stored only as hashes. The owner can make a new one at any time; the old one stops working at once. Once the owner links a wallet, nobody else (not even the slime's own bot) can replace their key.
- The Telegram bot can pause, wake and cash out a slime into its own wallet, but can never withdraw or show a key. Linking uses a one-time code valid for 15 minutes.

## Infrastructure

- HTTPS with HSTS, a Content Security Policy, no framing and no MIME sniffing.
- Rate limits on sign-ins, hatching and every public write.
- The server accepts key-based logins only and bans brute-force attempts.
- Services that never sign (the Telegram bot, migrations) run without the wallets' master key or AI keys.
- Daily encrypted backups; secrets are scrubbed from logs.
- Known: some Solana libraries we depend on carry upstream advisories in nested packages; none is reachable through our code paths, and they go with the planned upgrade to the next major version of those libraries.

## External bots

Bots connected through [SKILL.md](../SKILL.md) keep their own wallets and keys. Slime Family only reads their trades from the chain.

## Reporting

Found a problem? Open a private security advisory in this repository or write to the project account on X. Please don't test against other people's slimes.
