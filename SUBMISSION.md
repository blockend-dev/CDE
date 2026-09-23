# Submission Pack — Bitget AI · Genesis Season 2

Drafted material for the official submission form (Google Form, `forms.gle/GyWZCMCPocgJdJon6` as of last check). Every factual claim below matches [README.md](README.md); nothing here claims anything the repository does not do. Fields marked `[PLACEHOLDER]` need a human decision or a live URL this assistant cannot create — see [Form caveats](#form-caveats) for what to resolve before submitting.

## Project name

Corroboration Differential Engine (CDE)

## One-line summary (≤140 characters)

> CDE: does an LLM trading agent react differently to an unverified market claim when independent corroboration is harder to obtain?

(130 characters.)

## Track

Agentic Trading

## Sub-theme

Open Theme — closest fit is the track's own example direction, "Agent evaluation / benchmarks" (decision consistency, claim susceptibility, evidence usage, stress behavior), not any of the five named sub-themes, which assume live or paper-traded execution this project deliberately does not have. See [Form caveats](#form-caveats) for the honest tension this creates against the track's stated scoring mix.

## Six-part project description

### 1. Thesis

CDE tests whether an LLM trading agent's structured decision, when shown an unverified market claim, changes depending on whether independent price-discovery corroboration is available (NYSE-open weekday) or unavailable (NYSE-closed weekend, using Bitget's continuously-priced rToken instruments). Each of 41 paired trials holds one frozen market snapshot, tools, model, and configuration constant and varies only whether the claim was shown, then compares the weekday/weekend difference in the resulting exposure change — a difference-in-differences design. The pre-registered result: DiD = −0.0025, 95% CI [−0.0075, 0.0000], permutation p = 0.4909 — a small effect, with weak statistical evidence of a real difference, in a study not powered to rule a real effect out. This is an evaluation harness, not a trading strategy: it exists to test agent trustworthiness under adversarial, unverified information before autonomous decisions are trusted, not to produce a return.

### 2. Target user and product value

Teams and researchers deploying LLM-based trading agents who need to evaluate the agent's susceptibility to unverified market claims — and whether that susceptibility changes with market conditions — before allowing autonomous, risk-managed decisions. Not general retail traders; this is a pre-deployment evaluation tool for agent builders and reviewers, not a signal for personal trading decisions.

### 3. Validation data and key metrics

**Observed:** 41 completed paired trials (82 individual trials), 21 weekday / 20 weekend; one further attempt excluded for failing schema validation and preserved rather than discarded (42 attempted). Primary result: DiD(exposureDelta) = −0.0025, 95% bootstrap CI [−0.0075, 0.0000], two-sided permutation p = 0.4909 (10,000 permutations, seed 424242). The p-value has a disclosed, small order-of-computation sensitivity (range ≈0.4776–0.4966 across every input order tested); the point estimate and interval do not vary — see [REPRODUCIBILITY.md](REPRODUCIBILITY.md). No power calculation was performed, so this null result cannot be read as evidence of no effect.

**Not measured, and not estimated:** Sharpe, Sortino, drawdown, win rate, or any P&L figure. This is a replay-only, decision-level evaluation, not a live or paper-trading track record.

### 4. Progress

**Built:** the full frozen research pipeline (`cde/`) — locked methodology and pre-registered analysis plan, a real Anthropic model adapter, paired trial execution, the completed 41-pair research run, and its locked statistical analysis. A read-only, judge-facing demo (`demo/`) — Lab, Case Files, Counterfactual comparison, Truth→Claim→Corroboration→Belief→Action chain, Evidence X-Ray, Provenance explorer, Claim-blind Baseline, an Integrity Console with live re-verification and an input-order sensitivity re-run, a live tamper-attack demonstration, and a scripted Judge Mode walkthrough.

**Not built:** any live Bitget trading integration (Agent Hub, MCP, Playbook), any paper-trading evaluation, and any multi-model or multi-configuration comparison — see [README.md § What would be next](README.md#what-would-be-next).

**Frameworks/APIs used:** Node.js (no framework) for the research core and demo server; the Anthropic Messages API (research run only, never called live by the demo); Three.js and Anime.js for the demo's visualization layer, served from `node_modules`, no CDN.

### 5. Deliverables

A GitHub repository (frozen research core, demo, and this documentation), a locally-run demo (`npm install && npm run demo`, `http://localhost:5175`), a scripted 60–90 second Judge Mode walkthrough inside that demo, `README.md` / `ARCHITECTURE.md` / `REPRODUCIBILITY.md` at the repository root, and the X post linked in this submission. See [Submission materials checklist](#submission-materials-checklist) below for exact links.

### 6. Your take on AI Trading (optional)

The most useful thing an agent-evaluation project like this can do before a hackathon deadline is disclose its own limits as precisely as it discloses its result — a small, honestly-reported null finding with a documented reproducibility caveat is more useful to a team deciding whether to trust an agent than a larger claim without one.

## Role of the LLM / AI in your project

One model, one configuration, used only for the frozen research run — never invoked live by the demo. Model: `claude-sonnet-5` (Anthropic), temperature 0, max 1024 tokens, up to 8 tool-calling turns per trial. Role: the model **under evaluation**, not a tool used to build the evaluation. For each of 82 trials (41 pairs) it received a fixed system prompt (`cde/phase2/prompt.js`) and the same five-tool manifest (`get_quote`, `get_orderbook`, `get_market_status`, `get_claims_feed`, `propose_action` — `cde/lib/tools.js`) as every other trial, examined a frozen market snapshot (and, in Injected trials only, one additional unverified claim), and returned a structured decision (direction, exposure, confidence, claim assessment) validated against a fixed schema. No chain-of-thought is captured or displayed anywhere in this instrument — only the model's own structured fields. No Qwen credits were used.

## Submission materials checklist

Links to fill in before submitting — none of these exist yet and none are invented here:

- [ ] **GitHub URL** — `[PLACEHOLDER: public repository URL]`. There is currently no git remote configured; this repository needs to be pushed to a public (or judge-accessible) repository first.
- [ ] **Hosted demo URL** — `[PLACEHOLDER]`. The demo currently only runs locally (`npm run demo`, `http://localhost:5175`); it has no hosting configured. If no host is set up before the deadline, say so in the form rather than leaving a broken link.
- [ ] **Video URL** — `[PLACEHOLDER]`. Script drafted in [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md); needs to be recorded and uploaded.
- [ ] **X post URL** — `[PLACEHOLDER]`. Draft in [X_POST.md](X_POST.md); needs to be posted from the team's account, retweeting the official announcement, before the URL can be filled in here.
- [ ] **Bitget UID** — `[PLACEHOLDER]`.
- [ ] **Team name, Team Lead email, Team Lead contact (Telegram or other), Member background** — `[PLACEHOLDER]`, all team/personal details the submitting human should fill in directly rather than have drafted on their behalf.

## Form caveats

- **Deadline discrepancy, and re-verify before submitting.** The Bitget hackathon landing page (`bitget.com/activity-hub/hackathon`) states a submission deadline of 9/21; the official developer guide (GitBook, `bitget-ai.gitbook.io/bitgetai_hackathons2`) and the live Google Form both stated **September 27, 23:59 UTC+8** as of the last time they were checked. That check is now several days old — **re-open the live Google Form and re-read its stated deadline before submitting**, rather than trusting either date here.
- **Track/sub-theme fit is imperfect, and that is stated plainly rather than hidden.** The official guide scores Agentic Trading as "50% quantitative + 50% judge," with required materials including a paper-trading log "actually run during competition period, recommended ≥2 weeks." CDE has no paper-trading log and no quantitative trading metrics — its quantitative content is the DiD/CI/p-value of a decision-level evaluation, not a Sharpe/return-style trading number. Open Theme, whose own example direction is agent evaluation/benchmarks, is the closest honest fit; it is not a perfect fit, and no attempt was made here to manufacture paper-trading data to close that gap. Confirm this track/sub-theme choice is still the right call before submitting.
- **"Did this team participate in S1?"** — needs the submitting team to confirm. This repository's own git history starts 2026-09-19, with no reference anywhere in its tracked files to an S1 entry; if the team (as opposed to this specific repository) did participate in S1, the form's "Material Additions Since S1" field needs the team's own honest account, not a guess from this document.
- **"Apply for Post-event Kimi K3 Token Credits"** — the official form requires a Yes/No answer here; this document does not choose one. Decide based on the team's own preference.
- **"Open to Playbook Review and Listing Discussion"** — likewise requires a Yes/No answer the team should choose directly; this document does not decide it, and nothing in this repository has been built with Playbook listing in mind.
- **University Special Prize and Demo Day** — both optional; fill in only if applicable/desired.
