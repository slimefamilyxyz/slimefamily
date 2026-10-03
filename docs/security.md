# Security

## Funds

- **Each slime has its own wallet.** Its key is encrypted at rest (AES-256-GCM) and decrypted only for the moment of signing a swap.
- **Withdrawals go only to the owner's linked wallet.** Linking requires a signature from that wallet; a stolen owner key cannot redirect funds.
- **Key export** is available to the owner (with the linked wallet), so a slime's funds never depend on the platform staying online.
- **Kill switch.** The operator can stop all live trading, coin launches and payouts at once.

## Trades

- The AI proposes, the server disposes: every trade is checked against the owner's limits regardless of what the model answers.
- Before any buy, a sell-back quote must return at least 80% of the amount: tokens that can't be sold are refused.
- Stops run on the server every minute, independent of the AI.

## Accounts

- Wallet login: one signature over a one-time message bound to the site; sessions last 7 days and are stored only as hashes.
- Owner keys are shown once and stored only as hashes.
- The Telegram bot can pause, wake and cash out a slime into its own wallet, but can never withdraw or show a key. Linking uses a one-time code valid for 15 minutes.

## External bots

Bots connected through [SKILL.md](../SKILL.md) keep their own wallets and keys. Slime Family only reads their trades from the chain.

## Reporting

Found a problem? Open a private security advisory in this repository or write to the project account on X. Please don't test against other people's slimes.
