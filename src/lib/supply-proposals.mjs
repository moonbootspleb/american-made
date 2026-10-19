import { existsSync, readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { z } from 'zod';
import { countryCode } from './places.mjs';
import { claimSentence, reviewGaps } from './proposal-review.mjs';
import { textFragmentUrl } from './quote-match.mjs';

/**
 * A research proposal is a lead. It is not a supply link.
 * The research command may write these files. It must not write src/data/supply-links.
 */

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const linkId = z.string().regex(/^[a-z0-9]+(?:--?[a-z0-9]+)*$/);

export const sourceCheckSchema = z
  .object({
    checkedAt: z.string().min(1),
    ok: z.boolean(),
    httpStatus: z.number().int().optional(),
    error: z.string().max(300).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    quoteFound: z.boolean(),
    method: z.enum(['exact', 'normalized', 'trimmed', 'none']),
    paragraph: z.number().int().min(0).optional(),
    heading: z.string().max(300).optional(),
    title: z.string().max(300).optional(),
    publisher: z.string().max(160).optional(),
    published: z.string().max(40).optional(),
  })
  .strict();

export const reviewSchema = z
  .object({
    proposalId: linkId,
    decision: z.enum(['verify', 'needs-source', 'reject']),
    reviewer: z.string().min(1).max(80),
    decidedAt: z.string().min(1),
    sourceUrl: z.string().url(),
    claim: z.string().min(1).max(300),
    quote: z.string().min(1).max(500),
    liveTextSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    quoteFound: z.boolean().nullable(),
    viewerQuoteFound: z.boolean().nullable().optional(),
    fetchError: z.string().max(300).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const proposalSchema = z
  .object({
    id: linkId,
    status: z.enum(['open', 'needs-source', 'rejected', 'filed']),
    customer: z
      .object({
        slug,
        name: z.string().min(1).max(160),
      })
      .strict(),
    supplier: z
      .object({
        slug,
        name: z.string().min(1).max(160),
        identified: z.boolean(),
        website: z.string().url().optional(),
        address: z.string().min(1).max(200).optional(),
        city: z.string().min(1).max(80).optional(),
        region: z.string().min(1).max(80).optional(),
        country: countryCode.optional(),
      })
      .strict(),
    input: z
      .object({
        key: slug,
        name: z.string().min(1).max(120),
      })
      .strict(),
    tierHint: z.number().int().min(1).max(12),
    quote: z.string().min(1).max(500),
    sourceUrl: z.string().url(),
    addressSourceUrl: z.string().url().optional(),
    confidence: z.enum(['low', 'medium', 'high']),
    fetchedAt: z.string().min(1).optional(),
    filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** One plain sentence. When absent, the review card builds it from supplier, input, and customer. */
    claim: z.string().min(1).max(300).optional(),
    /** What the quote does not establish, written by research after reading the page. */
    gaps: z.array(z.string().min(1).max(400)).max(8).optional(),
    /** Last live check of the quote, written by `npm run research -- --check-sources`. */
    sourceCheck: sourceCheckSchema.optional(),
    /** Last reviewer decision, with the audit fields. Every decision is also appended to src/data/review-audit. */
    review: reviewSchema.optional(),
    /**
     * Present only after a street address and an address source were geocoded.
     * Both source URLs are required. A city centroid must not be stored here.
     */
    coordinates: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        address: z.string().min(1).max(200),
        addressSourceUrl: z.string().url(),
        geocodeSourceUrl: z.string().url(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * @param {string} value
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Array<{ path: string, raw: unknown }>} files
 * @param {Set<string>} [manufacturerSlugs]
 */
export function validateProposals(files, manufacturerSlugs) {
  /** @type {string[]} */
  const issues = [];
  /** @type {Array<z.infer<typeof proposalSchema>>} */
  const proposals = [];
  const seen = new Set();
  for (const { path, raw } of files) {
    const parsed = proposalSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) issues.push(`${path} ${issue.path.join('.')}: ${issue.message}`);
      continue;
    }
    const proposal = parsed.data;
    const fileId = nodePath.basename(path).replace(/\.json$/, '');
    if (fileId !== proposal.id) issues.push(`${path} must use id "${fileId}" so the filename and the record match.`);
    if (seen.has(proposal.id)) issues.push(`${path} repeats proposal id "${proposal.id}".`);
    seen.add(proposal.id);
    if (manufacturerSlugs && !manufacturerSlugs.has(proposal.customer.slug)) {
      issues.push(`${path} names manufacturer "${proposal.customer.slug}", which has no file.`);
    }
    if (proposal.coordinates) {
      if (proposal.coordinates.address !== proposal.supplier.address) {
        issues.push(`${path} coordinates must use the supplier street address.`);
      }
      if (!proposal.addressSourceUrl || proposal.coordinates.addressSourceUrl !== proposal.addressSourceUrl) {
        issues.push(`${path} coordinates need the same address source as the proposal.`);
      }
    }
    proposals.push(proposal);
  }
  return { proposals, issues };
}

/**
 * @param {string} root
 */
export function loadProposalsFromDisk(root) {
  const dir = nodePath.join(root, 'src/data/supply-proposals');
  const manufacturerDir = nodePath.join(root, 'src/data/manufacturers');
  /** @type {Set<string>} */
  const manufacturerSlugs = new Set();
  if (existsSync(manufacturerDir)) {
    for (const name of readdirSync(manufacturerDir)) {
      if (name.endsWith('.json')) manufacturerSlugs.add(name.replace(/\.json$/, ''));
    }
  }
  /** @type {string[]} */
  let names = [];
  if (existsSync(dir)) names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const files = names.map((name) => {
    const path = `src/data/supply-proposals/${name}`;
    try {
      return { path, raw: JSON.parse(readFileSync(nodePath.join(dir, name), 'utf8')) };
    } catch (error) {
      return { path, raw: { __parseError: error instanceof Error ? error.message : String(error) } };
    }
  });
  return validateProposals(files, manufacturerSlugs.size > 0 ? manufacturerSlugs : undefined);
}

/**
 * Disk when this checkout has proposal JSON files.
 * The Netlify function packages src/data/manufacturers and does not package the proposals directory,
 * so a manufacturer directory alone must not hide the bundled list.
 * @param {string} root
 * @param {unknown[]} [bundled]
 */
export function loadProposalsForAdmin(root = process.cwd(), bundled = []) {
  const proposalDir = nodePath.join(root, 'src/data/supply-proposals');
  const bundledList = Array.isArray(bundled) ? bundled : [];
  const hasProposalFile =
    existsSync(proposalDir) && readdirSync(proposalDir).some((name) => name.endsWith('.json'));
  if (hasProposalFile || bundledList.length === 0) {
    return { ...loadProposalsFromDisk(root), source: 'disk' };
  }
  const files = bundledList.map((raw, index) => {
    const id = raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : `bundled-${index}`;
    return { path: `src/data/supply-proposals/${id}.json`, raw };
  });
  return { ...validateProposals(files), source: 'bundle' };
}

/**
 * @param {z.infer<typeof proposalSchema>[]} proposals
 * @param {string[]} [issues]
 */
export function renderProposalSection(proposals, issues = []) {
  const rows = [...proposals].sort((a, b) => a.supplier.name.localeCompare(b.supplier.name));
  const issueBlock =
    issues.length > 0
      ? `<div class="queue-note" role="alert"><p>${escapeHtml(issues.join(' '))}</p></div>`
      : '';
  const cards =
    rows.length === 0
      ? '<p class="lede" role="status">No supply proposals on file.</p>'
      : `<ol class="queue queue--proposals">${rows.map((proposal) => renderProposalCard(proposal, proposals)).join('')}</ol>`;
  return `<section id="supply-proposals" aria-labelledby="supply-proposals-heading">
  <h2 id="supply-proposals-heading">Supply proposals</h2>
  <p class="lede">Leads from the research command. The live source page loads on the left with the quote highlighted. Check the claim against it. Verify files an unverified supply link in a checkout. It does not publish a company, and it does not mark the link verified.</p>
  ${issueBlock}
  ${cards}
</section>`;
}

/**
 * @param {string} value
 */
function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} url
 */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * @param {z.infer<typeof proposalSchema>} proposal
 * @param {z.infer<typeof proposalSchema>[]} all
 */
function renderProposalCard(proposal, all) {
  const id = escapeHtml(proposal.id);
  const open = proposal.status === 'open' || proposal.status === 'needs-source';
  const check = proposal.sourceCheck;
  const claim = claimSentence(proposal);
  const gaps = reviewGaps(proposal, all);
  const fragment = textFragmentUrl(proposal.sourceUrl, proposal.quote);
  const title = check?.title || '';
  const publisher = check?.publisher || hostOf(proposal.sourceUrl);
  const published = dateLabel(check?.published || '');
  const sourceLine = [
    title ? `<strong>${escapeHtml(title)}</strong>` : '',
    escapeHtml(publisher),
    published ? `published ${escapeHtml(published)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const research = check
    ? check.ok
      ? check.quoteFound
        ? `Research check ${escapeHtml(dateLabel(check.checkedAt))}: found${check.method === 'exact' ? ' verbatim' : ' (quote marks and spacing folded)'}${
            check.paragraph ? `, paragraph ${check.paragraph}${check.heading ? "" : " of the page"}` : ''
          }${check.heading ? ` under “${escapeHtml(check.heading)}”` : ''}.`
        : `Research check ${escapeHtml(dateLabel(check.checkedAt))}: quote not found in source.`
      : `Research check ${escapeHtml(dateLabel(check.checkedAt))}: the page did not load (${escapeHtml(check.error || 'no detail')}).`
    : 'No research check on file. Run npm run research -- --check-sources.';
  const gapList =
    gaps.length > 0
      ? `<ul class="review-gaps">${gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul>`
      : '<p class="hint">No gap noted. Read the passage in context before verifying.</p>';
  const address = proposal.supplier.address
    ? `<div><p class="meta-label">Street address</p><p>${escapeHtml(proposal.supplier.address)}</p></div>`
    : '';
  const lastReview = proposal.review
    ? `<p class="hint">Last decision: ${escapeHtml(proposal.review.decision)} by ${escapeHtml(proposal.review.reviewer)} at ${escapeHtml(
        proposal.review.decidedAt,
      )}.</p>`
    : '';
  const actions = open
    ? `<form class="review-form" method="post" action="/api/admin/proposals">
        <input type="hidden" name="id" value="${id}">
        <input type="hidden" name="viewerQuoteFound" value="" data-viewer-found>
        <label class="review-field"><span class="meta-label">Reviewer</span><input name="reviewer" maxlength="80" autocomplete="name" placeholder="Your name"></label>
        <label class="review-field"><span class="meta-label">Note (optional)</span><textarea name="note" rows="2" maxlength="1000"></textarea></label>
        <div class="proposal-actions">
          <button class="button button--quiet" type="submit" name="action" value="verify">Verify</button>
          ${proposal.status === 'open' ? '<button class="button button--quiet" type="submit" name="action" value="needs-source">Needs source</button>' : ''}
          <button class="button button--quiet" type="submit" name="action" value="reject">Reject</button>
        </div>
        <p class="hint">Each decision records the claim, the quote, the source URL, a hash of the live page text fetched at that moment, and whether the quote was on it.</p>
      </form>`
    : '';
  return `<li class="queue-card review-card" id="proposal-${id}" data-supply-proposal="${id}">
    <header>
      <p class="kicker">Supply proposal · ${escapeHtml(proposal.status)}</p>
      <p class="hint">${escapeHtml(proposal.confidence)} confidence · tier ${proposal.tierHint}</p>
    </header>
    <h2>${escapeHtml(proposal.supplier.name)}</h2>
    <div class="review-split">
      <div class="review-source">
        <p class="review-source__bar"><span class="meta-label">Live source</span> <a href="${escapeHtml(proposal.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostOf(proposal.sourceUrl))}</a></p>
        <iframe class="review-frame" src="/api/admin/source-view?proposal=${encodeURIComponent(proposal.id)}" title="Live source page for ${escapeHtml(proposal.supplier.name)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" data-source-frame></iframe>
      </div>
      <div class="review-panel">
        <div><p class="meta-label">Claim to verify</p><p class="review-claim">${escapeHtml(claim)}</p></div>
        <div><p class="meta-label">Quote</p><blockquote class="review-quote"><mark>${escapeHtml(proposal.quote)}</mark></blockquote></div>
        <div><p class="meta-label">Match on the live page</p><p class="review-status" data-quote-status="pending" role="status">Loading the live page…</p><p class="hint">${research}</p></div>
        <div><p class="meta-label">What the quote does not establish</p>${gapList}</div>
        <div><p class="meta-label">Source</p><p>${sourceLine}</p><p class="review-links"><a href="${escapeHtml(fragment)}" target="_blank" rel="noopener noreferrer">Open live page at the quote</a></p></div>
        <div class="queue-meta">
          <div><p class="meta-label">Customer</p><p>${escapeHtml(proposal.customer.name)}</p></div>
          <div><p class="meta-label">Input</p><p>${escapeHtml(proposal.input.name)}</p></div>
          ${address}
        </div>
        ${lastReview}
        ${actions}
      </div>
    </div>
  </li>`;
}
