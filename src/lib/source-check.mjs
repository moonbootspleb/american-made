import { readFileSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { liveQuoteCheck } from './source-view.mjs';
import { loadProposalsFromDisk, sourceCheckSchema } from './supply-proposals.mjs';

/**
 * Research step: fetch each open proposal's live source, check the quote against the page text,
 * and store the result on the proposal as `sourceCheck`. A miss is stored as a miss.
 * The page text itself is not stored; the review card loads the live page.
 * @param {{ root: string, id?: string, fetchImpl?: typeof fetch, now?: () => Date }} options
 */
export async function runSourceChecks(options) {
  const loaded = loadProposalsFromDisk(options.root);
  if (loaded.issues.length > 0) throw new Error(loaded.issues.join('\n'));
  const targets = loaded.proposals.filter((proposal) =>
    options.id ? proposal.id === options.id : proposal.status === 'open' || proposal.status === 'needs-source',
  );
  if (options.id && targets.length === 0) throw new Error(`No proposal with id ${options.id}.`);
  const now = options.now || (() => new Date());
  /** @type {Map<string, Awaited<ReturnType<typeof liveQuoteCheck>> | { ok: false, error: string }>} */
  const pages = new Map();
  const rows = [];
  for (const proposal of targets) {
    const key = `${proposal.sourceUrl}\n${proposal.quote}`;
    if (!pages.has(key)) pages.set(key, await liveQuoteCheck(proposal.sourceUrl, proposal.quote, options.fetchImpl));
    const check = /** @type {any} */ (pages.get(key));
    const sourceCheck = sourceCheckSchema.parse(
      check.ok
        ? {
            checkedAt: now().toISOString(),
            ok: true,
            httpStatus: check.status,
            sha256: check.sha256,
            quoteFound: check.found,
            method: check.method,
            ...(check.found ? { paragraph: check.paragraph } : {}),
            ...(check.found && check.heading ? { heading: check.heading.slice(0, 300) } : {}),
            ...(check.title ? { title: check.title } : {}),
            ...(check.publisher ? { publisher: check.publisher } : {}),
            ...(check.published ? { published: check.published } : {}),
          }
        : {
            checkedAt: now().toISOString(),
            ok: false,
            ...(check.status ? { httpStatus: check.status } : {}),
            error: String(check.error || 'not fetched').slice(0, 300),
            quoteFound: false,
            method: 'none',
          },
    );
    const path = nodePath.join(options.root, 'src/data/supply-proposals', `${proposal.id}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, `${JSON.stringify({ ...raw, sourceCheck }, null, 2)}\n`);
    rows.push({ id: proposal.id, ...sourceCheck });
  }
  return rows;
}
