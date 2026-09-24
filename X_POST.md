# X Post Draft

The official rules require **retweeting Bitget's own announcement post** in addition to this. That announcement's exact URL was not published in the developer guide at the time this was drafted (marked `[TBD: X link]` there) — **find and retweet Bitget's official Genesis Season 2 announcement post from `@Bitget_AI` before or alongside posting this**; do not skip that step, and do not substitute a guessed URL.

## Draft post (fits a standard 280-character post)

> Introducing CDE — Corroboration Differential Engine. We test whether an LLM trading agent reacts differently to an unverified market claim when independent price corroboration is unavailable (Clean vs Injected, weekday vs weekend). Small, non-significant result — not a profitability claim.
> Repo/demo: [PLACEHOLDER]
> #BitgetHackathon @Bitget_AI

(≈290 characters including the placeholder line — trim the middle sentence if the platform's limit is tighter once the real link is substituted; do not trim the "not a profitability claim" clause, since that is the one sentence doing the disclosure work.)

## Longer variant (if a long-form post is available)

> **CDE — Corroboration Differential Engine**
>
> Does an LLM trading agent's decision change when it's shown an unverified market claim, depending on whether independent price discovery is actually available to check that claim against?
>
> We built a paired Clean vs Injected evaluation: same market snapshot, same tools, same model, same configuration — the only thing that differs is whether a claim was shown. 41 pairs, 21 weekday (NYSE open) / 20 weekend (NYSE closed, Bitget rTokens still pricing).
>
> Result: a small difference-in-differences with weak statistical evidence behind it (−0.0025, 95% CI touching zero, p ≈ 0.49). Not a profitability claim, not a trading signal — an evaluation of agent susceptibility to unverified claims, with every input hash-locked and every limitation disclosed, including a known Monte Carlo order-sensitivity in the p-value itself.
>
> We also tested real Bitget Demo execution directly — it authenticates and fills orders correctly, but Bitget's paper-trading service explicitly rejects the tokenized-stock instruments this research is about. We didn't swap in an unrelated crypto pair to manufacture a metric; we're disclosing the rejection instead.
>
> Evaluate the agent before trusting the agent.
>
> Repo/demo: [PLACEHOLDER]
>
> #BitgetHackathon @Bitget_AI

## Notes

- `[PLACEHOLDER]` is the public repository/hosted-demo link — not invented here; fill in once the repository is published (see [SUBMISSION.md § Submission materials checklist](SUBMISSION.md#submission-materials-checklist)).
- Neither draft claims Bitget Agent Hub, MCP, or Playbook integration, live trading, or any P&L/Sharpe/win-rate figure, matching [README.md § What CDE does NOT do](README.md#what-cde-does-not-do).
