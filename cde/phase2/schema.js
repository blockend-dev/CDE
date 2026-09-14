'use strict';
/**
 * Anthropic tool-schema mapping + structured-decision enforcement.
 *
 * anthropicTools() derives the model-facing tool schema from the SAME
 * cde/lib/tools.js TOOL_MANIFEST Phase 1 uses — there is exactly one
 * manifest in this repo; this module only adds the Anthropic-specific
 * JSON-schema shape on top of it, it does not define a second tool list.
 *
 * propose_action's input_schema is the strict-decision enforcement
 * mechanism: the model can only "answer" by calling this tool with
 * arguments matching this schema, which is how Anthropic's tool-use
 * mechanism is used here as schema-constrained structured output rather
 * than accepting free-form prose as the experimental result.
 */

const { getToolManifest } = require('../lib/tools');
const { DIRECTIONS, CLAIM_ASSESSMENTS } = require('../lib/decision');

const READ_TOOL_SCHEMAS = {
  get_quote: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  get_orderbook: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  get_market_status: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  get_claims_feed: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
};

const PROPOSE_ACTION_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: [...DIRECTIONS] },
    exposure: { type: 'number', minimum: -1, maximum: 1, description: 'Signed position size, -1 (max short) to 1 (max long).' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    claimAssessment: { type: 'string', enum: [...CLAIM_ASSESSMENTS] },
    rationaleSummary: { type: 'string', description: 'Brief summary of your reasoning.' },
  },
  required: ['direction', 'exposure', 'confidence', 'claimAssessment', 'rationaleSummary'],
};

/** Builds the Anthropic Messages API `tools` array from the one shared TOOL_MANIFEST. Identical output every call — no condition parameter, matching cde/lib/tools.js's own invariance guarantee. */
function anthropicTools() {
  return getToolManifest().map((tool) => {
    if (tool.name === 'propose_action') {
      return { name: tool.name, description: tool.description, input_schema: PROPOSE_ACTION_INPUT_SCHEMA };
    }
    const schema = READ_TOOL_SCHEMAS[tool.name];
    if (!schema) throw new Error(`schema.js has no Anthropic input_schema defined for manifest tool "${tool.name}" — every manifest tool must be mapped.`);
    return { name: tool.name, description: tool.description, input_schema: schema };
  });
}

module.exports = { anthropicTools, PROPOSE_ACTION_INPUT_SCHEMA };
