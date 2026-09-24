# Video Walkthrough Script (~100s)

For a screen recording of the demo (`npm run demo`, then either drive it manually along this script or start Judge Mode and narrate over it — the stage labels below match Judge Mode's own eight stages exactly, so the two stay in sync). Tone: technical, confident, honest. No hype, no claims the repository does not support.

---

**0:00–0:10 — Problem / why corroboration matters**

*On screen: the Lab, first viewport (`#/lab`).*

> "This is CDE — the Corroboration Differential Engine. It asks one question: when an LLM trading agent is handed an unverified market claim, does its decision change depending on whether independent price discovery is actually available to check that claim against?"

**0:10–0:25 — Market state + claim injection**

*On screen: scroll to "The Manipulation," then navigate to a pair's Chain tab, Market and Claim nodes (`#/pair/<key>/chain`).*

> "Weekday conditions have an open reference market — the NYSE. Weekend conditions don't, even though Bitget's rToken instruments keep pricing through the weekend. Every trial starts from one frozen, real market snapshot. In the Injected member of a pair, we add exactly one thing: an unverified claim, like this one — never confirmed true or false by this instrument."

**0:25–0:40 — Agent decision + Evidence X-Ray**

*On screen: Chain tab, Belief and Action nodes, then Evidence X-Ray (`#/pair/<key>/xray`).*

> "The agent gets the same tools either way — quote, order book, market status, a claims feed — and returns a structured decision: direction, exposure, confidence. Nothing here is inferred or summarized after the fact. Evidence X-Ray shows every tool call and every field exactly as the model returned it. No hidden reasoning."

**0:40–0:55 — Clean vs Injected comparison**

*On screen: Counterfactual tab (`#/pair/<key>/counterfactual`), then the claim-blind Baseline tab.*

> "Same snapshot, same tools, same model configuration — Clean and Injected differ in exactly one thing: whether the claim was shown. And this baseline can't see the claim at all, by construction, so its two outputs are always identical. It's a control, not a benchmark."

**0:55–1:10 — The DiD result**

*On screen: Lab, scroll to the Analysis and Result panels (`#/lab#result`).*

> "Across 41 pairs — 21 weekday, 20 weekend — the pre-registered result is a difference-in-differences of minus zero point zero zero two five, a 95 percent interval touching zero, and a permutation p of about 0.49. That's a small effect, and this sample doesn't give strong evidence of a real difference. It is *not* evidence that no effect exists — this study wasn't powered to rule that out."

**1:10–1:25 — Reproducibility / frozen evidence**

*On screen: Integrity Console (`#/integrity`) — click VERIFY EXPERIMENT, then the input-order re-run panel.*

> "Every one of those numbers comes from hash-locked, frozen files. This re-runs the real preflight engine and the real analysis right now, live. And because the underlying p-value is a Monte Carlo estimate that depends slightly on file-read order, we show that too — the estimate and interval never move; the p-value shifts by about what you'd expect from ten thousand permutations. Disclosed, not hidden."

**1:25–1:38 — Bitget Demo execution: tested, not substituted**

*On screen: stay on the Integrity Console, or cut to a still of the README's Bitget Demo execution section — this finding has no dedicated UI panel, and none was built to manufacture one.*

> "We also asked whether this could run as real Bitget paper trading. We authenticated against Bitget's own Demo environment and confirmed it genuinely executes — a real buy and sell filled on BTCUSDT. But Bitget's paper-trading service explicitly rejects orders on the tokenized-stock instruments this research is about, across every symbol and order type we tried. So we didn't swap in an unrelated crypto pair and call it the same experiment — we're showing you the rejection instead."

**1:38–1:43 — One-line takeaway**

*On screen: back to the Lab hero.*

> "Evaluate the agent before trusting the agent — that's what CDE is built to do."

---

**Do not say:** "we proved," "AI cannot be trusted," "weekends are fake," "Bitget prices are manipulated," or anything implying a live trading result, a profitability claim, or a Bitget Agent Hub/MCP/Playbook integration that does not exist.
