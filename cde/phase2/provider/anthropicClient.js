'use strict';
/**
 * Thin Anthropic SDK wrapper. Everything provider-specific lives here —
 * cde/phase2/realModelAdapter.js never imports @anthropic-ai/sdk directly,
 * so a second provider could be added later as a sibling module (e.g.
 * cde/phase2/provider/openaiClient.js) implementing the same
 * `createMessage()`/error-mapping shape, without touching the adapter or
 * the experiment-domain logic at all.
 *
 * Retries happen HERE, inside a single logical model-invocation call, and
 * are recorded as `attempts` on the returned envelope — a retried request
 * is still one invocation, never a second trial (see realModelAdapter.js).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { AdapterFailure } = require('../failures');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyProviderError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AdapterFailure('authentication_or_configuration', `Anthropic authentication/configuration error: ${err.message}`, { status: err.status });
  }
  if (err instanceof Anthropic.BadRequestError) {
    // A malformed/unsupported request (e.g. an unsupported parameter for
    // the chosen model) is a configuration problem, not a transient
    // network issue — and must not be retried, since retrying the same
    // malformed request will just fail identically.
    return new AdapterFailure('authentication_or_configuration', `Anthropic rejected the request as malformed: ${err.message}`, { status: err.status });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AdapterFailure('rate_limit', `Anthropic rate limit: ${err.message}`, { status: err.status });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AdapterFailure('timeout', `Anthropic request timed out: ${err.message}`, {});
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AdapterFailure('provider_network', `Anthropic connection error: ${err.message}`, {});
  }
  if (err instanceof Anthropic.APIError) {
    return new AdapterFailure('provider_network', `Anthropic API error (${err.status}): ${err.message}`, { status: err.status });
  }
  return new AdapterFailure('provider_network', `Unclassified provider error: ${err.message}`, {});
}

function isRetryable(failure) {
  return ['rate_limit', 'timeout', 'provider_network'].includes(failure.category);
}

class AnthropicProviderClient {
  /** @param {object} cfg { apiKey, model, temperature, maxTokens, retryPolicy: {maxAttempts, baseDelayMs} } */
  constructor(cfg) {
    if (!cfg.apiKey) {
      // Fail fast and typed, rather than letting the SDK throw its own
      // untyped error later on the first real call.
      this._missingKey = true;
    }
    this.model = cfg.model;
    this.temperature = cfg.temperature;
    this.maxTokens = cfg.maxTokens;
    this.retryPolicy = cfg.retryPolicy || { maxAttempts: 1, baseDelayMs: 0 };
    this._client = cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : null;
  }

  /**
   * @param {object} params { system, messages, tools }
   * @returns {Promise<{response: object, attempts: Array<{attempt:number, outcome:'success'|'failed', category?:string, tookMs:number}>}>}
   */
  async createMessage({ system, messages, tools }) {
    if (this._missingKey) {
      throw new AdapterFailure('authentication_or_configuration', 'ANTHROPIC_API_KEY is not set in the environment.', {});
    }

    const attempts = [];
    let lastFailure = null;

    for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt++) {
      const startedAt = Date.now();
      try {
        const requestParams = { model: this.model, max_tokens: this.maxTokens, system, messages, tools };
        // `temperature` is deliberately omitted from the actual request
        // when the configured model doesn't accept it — discovered live
        // against the real API (some current models reject it outright:
        // "temperature is deprecated for this model"), not assumed. The
        // configured value is still recorded in modelConfig/modelConfigHash
        // for provenance even when it can't be transmitted — see
        // cde/phase2/README.md, which documents this acknowledged gap in
        // sampling control rather than silently pretending it was applied.
        if (this.temperature !== null && this.temperature !== undefined && this._supportsTemperature !== false) {
          requestParams.temperature = this.temperature;
        }
        const response = await this._client.messages.create(requestParams);
        attempts.push({ attempt, outcome: 'success', tookMs: Date.now() - startedAt });
        return { response, attempts };
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && /temperature/i.test(err.message) && /deprecated|not supported|unsupported/i.test(err.message)) {
          // Self-correcting configuration adjustment, not a failure: this
          // model rejects `temperature` entirely. Disable it for the rest
          // of this client's lifetime and retry the SAME logical call
          // immediately — recorded as an attempt for full provenance, but
          // does not consume the transient-failure retry semantics.
          this._supportsTemperature = false;
          attempts.push({ attempt, outcome: 'reconfigured', note: 'disabled unsupported temperature parameter' });
          attempt -= 1; // do not count this against the loop's attempt progression
          continue;
        }
        const failure = classifyProviderError(err);
        attempts.push({ attempt, outcome: 'failed', category: failure.category, tookMs: Date.now() - startedAt });
        lastFailure = failure;
        if (!isRetryable(failure) || attempt === this.retryPolicy.maxAttempts) {
          lastFailure.details = { ...lastFailure.details, attempts };
          throw lastFailure;
        }
        await sleep(this.retryPolicy.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    // Unreachable in practice (the loop always returns or throws), kept for clarity/lint.
    throw lastFailure;
  }
}

module.exports = { AnthropicProviderClient, classifyProviderError, isRetryable };
