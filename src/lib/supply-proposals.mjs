import { existsSync, readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { z } from 'zod';
import { countryCode } from './places.mjs';

/**
 * A research proposal is a lead. It is not a supply link.
 * The research command may write these files. It must not write src/data/supply-links.
 */

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const linkId = z.string().regex(/^[a-z0-9]+(?:--?[a-z0-9]+)*$/);

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
      : `<ol class="queue">${rows.map(renderProposalCard).join('')}</ol>`;
  return `<section id="supply-proposals" aria-labelledby="supply-proposals-heading">
  <h2 id="supply-proposals-heading">Supply proposals</h2>
  <p class="lede">Leads from the research command. Verify files an unverified supply link in this checkout. It does not publish a company, and it does not mark the link verified.</p>
  ${issueBlock}
  ${cards}
</section>`;
}

/**
 * @param {z.infer<typeof proposalSchema>} proposal
 */
function renderProposalCard(proposal) {
  const id = escapeHtml(proposal.id);
  const actions =
    proposal.status === 'open' || proposal.status === 'needs-source'
      ? `<div class="proposal-actions">${actionForm(proposal.id, 'verify', 'Verify')}${
          proposal.status === 'open' ? actionForm(proposal.id, 'needs-source', 'Needs source') : ''
        }${actionForm(proposal.id, 'reject', 'Reject')}</div>`
      : '';
  const address = proposal.supplier.address
    ? `<div><p class="meta-label">Street address</p><p>${escapeHtml(proposal.supplier.address)}</p></div>`
    : '';
  return `<li class="queue-card" id="proposal-${id}" data-supply-proposal="${id}">
    <header>
      <p class="kicker">Supply proposal · ${escapeHtml(proposal.status)}</p>
      <p class="hint">${escapeHtml(proposal.confidence)} confidence · tier ${proposal.tierHint}</p>
    </header>
    <h2>${escapeHtml(proposal.supplier.name)}</h2>
    <div class="queue-meta">
      <div><p class="meta-label">Customer</p><p>${escapeHtml(proposal.customer.name)}</p></div>
      <div><p class="meta-label">Input</p><p>${escapeHtml(proposal.input.name)}</p></div>
      <div><p class="meta-label">Quote</p><p class="queue-body">${escapeHtml(proposal.quote)}</p></div>
      <div><p class="meta-label">Source</p><p><a href="${escapeHtml(proposal.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(proposal.sourceUrl)}</a></p></div>
      ${address}
    </div>
    ${actions}
  </li>`;
}

/**
 * @param {string} id
 * @param {string} action
 * @param {string} label
 */
function actionForm(id, action, label) {
  return `<form method="post" action="/api/admin/proposals">
    <input type="hidden" name="id" value="${escapeHtml(id)}">
    <input type="hidden" name="action" value="${escapeHtml(action)}">
    <button class="button button--quiet" type="submit">${escapeHtml(label)}</button>
  </form>`;
}
