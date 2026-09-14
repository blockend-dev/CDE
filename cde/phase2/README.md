# Phase 2 — real model adapter

Replaces `deterministicTestAdapter` behind the exact Phase 1 adapter
boundary with a real Anthropic-backed adapter. Nothing about snapshot
contracts, pairing logic, condition classification, the attack corpus, the
claim-blind baseline, the tool manifest, the result schema, the provenance
schema, or the methodology lock changed. `cde/phase1/trial.js` gained one
pluggable `adapter` option (default: Phase 1's own deterministic adapter,
unchanged behavior); everything else in Phase 1 is reused, not duplicated.

## Provider choice

Anthropic, via the official `@anthropic-ai/sdk`. Chosen because, checked
empirically from this environment before writing any code: `api.anthropic.com`
returned a real HTTP 401 (network-reachable, just unauthenticated), while
the alternative provider checked was unreachable outright. No existing
provider convention was found in the repo (`package.json` did not exist
before this phase).

## Structured decision enforcement

`propose_action` — already part of the one shared tool manifest
(`cde/lib/tools.js`) — is given a strict Anthropic `input_schema`
(`cde/phase2/schema.js`). The model can only "answer" by calling it; a
plain-text response is rejected with a one-time nudge, then, if it
persists, a typed `max_turns_exceeded` failure. Whatever the model submits
is still re-validated against `cde/lib/decision.js`'s `validateDecision()`
— the same validator Phase 1 uses — before being accepted as a trial
result; a schema-invalid submission is a typed `schema_validation_failure`,
never coerced into a fake decision.

## Prompt / leakage prevention

`cde/phase2/prompt.js` holds one fixed, versioned system prompt and task
template — mechanically checked (`assertNoLeakage`, exercised in
`cde/test/phase2.test.js`) against a forbidden-pattern list (weekday,
weekend, hypothesis, control/treatment, corroboration, susceptible,
injected, pairId, degraded, ...). Clean and Injected prompts are byte-
identical; the only difference is whatever `get_claims_feed` returns at
runtime. `get_market_status`'s response deliberately excludes the raw
`condition` ("weekday"/"weekend") label CDE itself uses internally — a
real trading system wouldn't expose its own research classification, only
naturally-observable facts (`underlyingNyseOpen`, `extendedSessionActive`).
This was caught by the Phase 2 test suite itself on the first run (see git
history / test failures during development) and fixed before anything was
accepted as passing.

## Failure handling

Typed categories in `cde/phase2/failures.js`
(`authentication_or_configuration`, `provider_network`, `rate_limit`,
`timeout`, `invalid_model_output`, `tool_invocation_failure`,
`schema_validation_failure`, `max_turns_exceeded`). Retries happen inside
`cde/phase2/provider/anthropicClient.js`'s single `createMessage()` call
and are recorded as multiple `attempts` on one logical invocation — never
as a second trial. `cde/phase2/runRealModelExperiment.js`'s
`buildPairSafely()` is where `completed` vs `failed` is decided; a failure
never becomes a fabricated decision.

## Secrets

`ANTHROPIC_API_KEY` is read from the environment only (`cde/phase2/config.js`),
never hardcoded. `cde/phase2/secretRedaction.js` is applied centrally inside
`AdapterFailure`'s constructor (message and details both), and again before
`smokeTest.js` writes anything to disk, with a hard refusal to write if a
secret is somehow still detected afterward.

## What this is not

Not connected to Bitget Demo, paper trading, or live trading anywhere.
The model interacts only with `cde/phase1/toolReplay.js`'s deterministic,
snapshot-backed replay client — the same one Phase 1 uses — against the
synthetic `FIXTURE:`-marked snapshots in `cde/phase1/fixtures/`. See
`cde/phase1/README.md` for why that data can never be mistaken for real
Bitget market data.

`cde/phase2/smokeTest.js` runs exactly one Clean/Injected pair against one
fixture snapshot, to prove the pipeline works end to end. Its output is
explicitly tagged `artifactType: "MODEL_SMOKE_TEST_NOT_RESEARCH_EVIDENCE"`
and must never be read as a research finding — the real four-cell,
research-scale run is out of scope for Phase 2.
