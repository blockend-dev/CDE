'use strict';
/**
 * Records the actual outcome of httpServer.js's boot-time attempt to
 * unshallow this checkout, so demo/server/integrity.js can report WHY its
 * content-hash fallback was needed from the real attempt's own result,
 * rather than guessing. Never written to except by that one attempt.
 */
const state = { attempted: false, wasShallow: null, unshallowed: null, error: null };

function record(partial) {
  Object.assign(state, partial);
}

module.exports = { state, record };
