'use strict';
/**
 * Typed adapter failure categories. A real model invocation has real
 * failure modes a synchronous fixture never does — this module is the
 * single place those are named, so the rest of the codebase can
 * distinguish `completed` from `failed` mechanically instead of by
 * inspecting error message strings.
 */

const FAILURE_CATEGORIES = Object.freeze([
  'authentication_or_configuration',
  'provider_network',
  'rate_limit',
  'timeout',
  'invalid_model_output',
  'tool_invocation_failure',
  'schema_validation_failure',
  'max_turns_exceeded',
]);

// Deliberately required lazily (not at module top) to avoid a require cycle:
// secretRedaction.js has no dependency on this module, so this is safe, but
// keeping it inline documents exactly why it's here.
const { redactString, redactSecrets } = require('./secretRedaction');

class AdapterFailure extends Error {
  /**
   * Redaction happens HERE, centrally, rather than relying on every call
   * site to remember to redact — message and details are scrubbed
   * unconditionally, so a secret can never reach a serialized artifact via
   * an AdapterFailure regardless of where it was thrown from.
   */
  constructor(category, message, details = {}) {
    super(redactString(String(message)));
    if (!FAILURE_CATEGORIES.includes(category)) {
      throw new Error(`AdapterFailure: unknown category "${category}". Must be one of ${FAILURE_CATEGORIES.join(', ')}.`);
    }
    this.name = 'AdapterFailure';
    this.category = category;
    this.details = redactSecrets(details);
  }
}

module.exports = { FAILURE_CATEGORIES, AdapterFailure };
