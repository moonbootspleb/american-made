import { appendFileSync, mkdirSync } from 'node:fs';
import nodePath from 'node:path';
import { reviewSchema } from './supply-proposals.mjs';
import { claimSentence } from './proposal-review.mjs';

/**
 * The audit record for one reviewer decision on a supply proposal.
 * The live text hash and quote-found flag come from a fetch made at decision time, not from the browser.
 */

const ACTION_IDS = new Set(['verify', 'needs-source', 'reject']);

/**
 * @param {unknown} value
 * @param {number} max
 */
function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * @param {{
 *   proposal: { id: string, sourceUrl: string, quote: string, claim?: string, supplier: { name: string, city?: string, region?: string }, customer: { name: string }, input: { name: string } },
 *   decision: string,
 *   reviewer?: string,
 *   note?: string,
 *   viewerQuoteFound?: string | boolean | null,
 *   check: { ok: boolean, sha256?: string, found?: boolean, error?: string },
 *   now?: Date,
 * }} input
 */
export function buildReviewRecord(input) {
  if (!ACTION_IDS.has(input.decision)) throw new Error(`Unknown decision ${input.decision}`);
  const viewer =
    input.viewerQuoteFound === true || input.viewerQuoteFound === 'true'
      ? true
      : input.viewerQuoteFound === false || input.viewerQuoteFound === 'false'
        ? false
        : null;
  const note = cleanText(input.note, 1000);
  /** @type {Record<string, unknown>} */
  const record = {
    proposalId: input.proposal.id,
    decision: input.decision,
    reviewer: cleanText(input.reviewer, 80) || 'admin',
    decidedAt: (input.now || new Date()).toISOString(),
    sourceUrl: input.proposal.sourceUrl,
    claim: claimSentence(input.proposal),
    quote: input.proposal.quote,
    liveTextSha256: input.check.ok && input.check.sha256 ? input.check.sha256 : null,
    quoteFound: input.check.ok ? Boolean(input.check.found) : null,
    viewerQuoteFound: viewer,
  };
  if (!input.check.ok) record.fetchError = cleanText(input.check.error || 'The live page was not fetched.', 300);
  if (note) record.note = note;
  return reviewSchema.parse(record);
}

/**
 * Append one record to src/data/review-audit/<proposal-id>.jsonl in a checkout.
 * @param {string} root
 * @param {ReturnType<typeof buildReviewRecord>} record
 */
export function appendAuditToDisk(root, record) {
  const dir = nodePath.join(root, 'src/data/review-audit');
  const path = nodePath.join(dir, `${record.proposalId}.jsonl`);
  if (!path.startsWith(`${dir}${nodePath.sep}`)) throw new Error('Audit path left the audit directory.');
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return path;
}
