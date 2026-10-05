// Excerpt, unchanged, from the platform's API (not compiled here): the only route that moves a live slime's money
// out of its wallet. Note the destination: always the owner's signature-linked wallet, never an address from the request.

  app.post('/api/owner/withdraw', async (req) => {
    const agent = await ownerAgent(req);
    if (agent.kind === 'external') throw new HttpError(400, 'an external agent moves its own funds');
    const evm = agent.chain !== 'solana' ? (deps.evmLive?.(agent.chain) ?? null) : null;
    if (agent.mode !== 'live' || (agent.chain === 'solana' ? !deps.live : !evm)) throw new HttpError(400, 'withdrawals are for live agents');
    const body = z.object({ usd: z.number().positive() }).parse(req.body);
    // Live money leaves only for the owner's linked wallet: a stolen owner key cannot send it anywhere else.
    if (!agent.ownerWallet) throw new HttpError(400, 'link your wallet first: withdrawals go only to the wallet linked to this slime');
    if (walletKind(agent.ownerWallet) !== (agent.chain === 'solana' ? 'svm' : 'evm')) throw new HttpError(400, `the linked wallet is not a ${CHAINS[agent.chain].name} wallet`);
    const to = agent.ownerWallet;
    // Take the agent's turn lock so no swap races the transfer.
    const t = now();
    const claim = await db.query(
      `update agents set thinking_since = $2 where id = $1 and thinking_since is null
       and not exists (select 1 from pending_swaps where agent_id = $1 and resolved_at is null) returning cash_usd`,
      [agent.id, t],
    );
    if (!claim.rowCount) throw new HttpError(409, 'the agent is mid-turn or a swap is settling; try again in a minute');
    try {
      const stable = CHAINS[agent.chain].stable;
      if (body.usd > Number(claim.rows[0].cash_usd) + 1e-6) throw new HttpError(400, `more than the agent holds in ${stable.symbol}; cash out positions first`);
      if (evm) {
        const out = await evmWithdraw(db, evm, agent, to, body.usd, t);
        if (out.status === 'failed') throw new HttpError(502, `transfer failed: ${out.error}`);
        return { status: out.status, signature: out.hash, token: stable.mint, to };
      }
      const out = await withdrawUsdc(db, deps.live!, agent, to, body.usd, t);
      if (out.status === 'failed') throw new HttpError(502, `transfer failed: ${out.error}`);
      return { status: out.status, signature: out.signature, token: USDC_MINT, to };
    } finally {
      // Release only our own claim: if the transfer outlived the stale-claim window, a turn may hold it now.
      await db.query('update agents set thinking_since = null where id = $1 and thinking_since = $2', [agent.id, t]);
    }
  });