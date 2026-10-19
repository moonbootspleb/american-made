import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { deriveFlag, validateSupplyLinks } from './supply-links.mjs';
import { appendAuditToDisk } from './review-audit.mjs';
import { loadProposalsFromDisk } from './supply-proposals.mjs';

/**
 * Human gate for a research proposal.
 * verify writes an unverified supply link, and a draft profile when the supplier is new.
 * reject and needs-source change the proposal status only.
 * This module does not mark a link verified.
 */

const PROPOSAL_ID = /^[a-z0-9]+(?:--?[a-z0-9]+)*$/;

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function researchWritesAllowed(env = process.env) {
  if (env.NETLIFY === 'true') return false;
  if (env.CONTEXT === 'production' || env.CONTEXT === 'deploy-preview' || env.CONTEXT === 'branch-deploy') return false;
  return true;
}

/**
 * @param {string | null | undefined} reason
 */
export function proposalResultNote(reason) {
  if (reason === 'filed') {
    return 'Filed an unverified supply link. A new supplier with a company site also got a draft profile. The link is not verified, and the profile is not published.';
  }
  if (reason === 'rejected') return 'Marked the proposal rejected. No supply link was written.';
  if (reason === 'needs-source') return 'Marked the proposal needs-source. No supply link was written.';
  if (reason === 'host-readonly-recorded') {
    return 'Recorded your decision for audit, with the live page hash and whether the quote was found. This host does not write data files, so the proposal status did not change. To file it, run in a checkout: npm run research -- --act <verify|needs-source|reject> --id <proposal-id>.';
  }
  if (reason === 'audit-failed') return 'The decision could not be saved to the audit log. Nothing changed. Try again.';
  if (reason === 'host-readonly') {
    return 'This host does not write data files. Run the action in a checkout: npm run research -- --act verify --id <proposal-id>.';
  }
  if (reason === 'link-exists') return 'A supply link with that id is already on file. Nothing was overwritten.';
  if (reason === 'already-closed') return 'That proposal is already filed or rejected.';
  if (reason === 'not-found') return 'No proposal with that id is on file.';
  if (reason === 'bad-id' || reason === 'bad-action') return 'That action was not recognized.';
  return '';
}

/**
 * @param {{ root: string, id: string, action: string, writesAllowed?: boolean, today?: string, review?: import('./review-audit.mjs').buildReviewRecord extends (...args: any[]) => infer R ? R : never }} options
 * When `review` is passed, it is stored on the proposal and appended to src/data/review-audit/<id>.jsonl.
 */
export function applyProposalAction(options) {
  const id = options.id || '';
  const action = options.action || '';
  if (!PROPOSAL_ID.test(id)) return { ok: false, status: 400, reason: 'bad-id' };
  if (action !== 'verify' && action !== 'reject' && action !== 'needs-source') {
    return { ok: false, status: 400, reason: 'bad-action' };
  }
  if (options.writesAllowed === false) return { ok: false, status: 409, reason: 'host-readonly' };

  const loaded = loadProposalsFromDisk(options.root);
  const proposal = loaded.proposals.find((item) => item.id === id);
  if (!proposal) return { ok: false, status: 404, reason: 'not-found' };

  if (action === 'reject' || action === 'needs-source') {
    if (proposal.status === 'filed' || proposal.status === 'rejected') {
      return { ok: false, status: 409, reason: 'already-closed' };
    }
    const next = action === 'reject' ? 'rejected' : 'needs-source';
    writeJson(proposalPath(options.root, id), withReview({ ...proposal, status: next }, options.review));
    if (options.review) appendAuditToDisk(options.root, options.review);
    return { ok: true, status: 200, reason: next, profile: 'unchanged' };
  }

  if (proposal.status === 'filed' || proposal.status === 'rejected') {
    return { ok: false, status: 409, reason: 'already-closed' };
  }
  const linkPath = nodePath.join(options.root, 'src/data/supply-links', `${id}.json`);
  if (existsSync(linkPath)) return { ok: false, status: 409, reason: 'link-exists' };

  const today = options.today || new Date().toISOString().slice(0, 10);
  const link = buildUnverifiedLink(proposal, today);
  const manufacturerSlugs = manufacturerSlugSet(options.root);
  const profile = draftProfileFor(proposal, today, manufacturerSlugs);
  if (profile) manufacturerSlugs.add(profile.slug);

  const existing = existingLinkFiles(options.root);
  const { issues } = validateSupplyLinks([...existing, { path: `src/data/supply-links/${id}.json`, raw: link }], manufacturerSlugs);
  if (issues.length > 0) return { ok: false, status: 422, reason: 'invalid-link', issues };

  writeJson(linkPath, link);
  let profileState = 'unchanged';
  if (profile) {
    try {
      writeDraftProfile(options.root, profile);
      profileState = 'draft';
    } catch (error) {
      if (existsSync(linkPath)) unlinkSync(linkPath);
      return {
        ok: false,
        status: 500,
        reason: 'profile-failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  writeJson(proposalPath(options.root, id), withReview({ ...proposal, status: 'filed', filedAt: today }, options.review));
  if (options.review) appendAuditToDisk(options.root, options.review);
  return { ok: true, status: 200, reason: 'filed', profile: profileState };
}

/**
 * @template T
 * @param {T} proposal
 * @param {unknown} review
 */
function withReview(proposal, review) {
  return review ? { ...proposal, review } : proposal;
}

/**
 * @param {string} root
 * @param {string} id
 */
function proposalPath(root, id) {
  const path = nodePath.join(root, 'src/data/supply-proposals', `${id}.json`);
  const dir = nodePath.join(root, 'src/data/supply-proposals');
  if (!path.startsWith(`${dir}${nodePath.sep}`)) throw new Error('Proposal path left the proposals directory.');
  return path;
}

/**
 * @param {import('./supply-proposals.mjs').proposalSchema extends import('zod').ZodType<infer T> ? T : never} proposal
 * @param {string} today
 */
export function buildUnverifiedLink(proposal, today) {
  const sources = linkSources(proposal, today);
  const addressSourceId = addressSourceIdFor(proposal);
  /** @type {Record<string, unknown>} */
  const hq = coordinatesReady(proposal)
    ? {
        address: proposal.coordinates.address,
        ...(proposal.supplier.city ? { city: proposal.supplier.city } : {}),
        ...(proposal.supplier.region ? { region: proposal.supplier.region } : {}),
        country: proposal.supplier.country || 'US',
        lat: proposal.coordinates.lat,
        lng: proposal.coordinates.lng,
        coordinateSources: [addressSourceId, 'geocode-source'],
        status: 'sourced',
        sources: [addressSourceId],
        note: 'Street address from the cited page. Coordinates are the geocode of that address.',
      }
    : {
        country: 'unknown',
        status: 'unverified',
        note: 'Filed from a research proposal. Headquarters was not established.',
      };
  /** @type {Record<string, unknown>} */
  const link = {
    id: proposal.id,
    lastReviewed: today,
    customer: {
      type: 'manufacturer',
      slug: proposal.customer.slug,
      name: proposal.customer.name,
    },
    supplier: {
      slug: proposal.supplier.slug,
      name: proposal.supplier.name,
      identified: proposal.supplier.identified,
      ...(proposal.supplier.website ? { website: proposal.supplier.website } : {}),
      hq,
    },
    input: {
      key: proposal.input.key,
      name: proposal.input.name,
      origins: [
        {
          country: 'unknown',
          status: 'unverified',
          note: 'The proposal does not establish where this input is made.',
        },
      ],
    },
    tier: proposal.tierHint,
    flag: 'unknown',
    status: 'unverified',
    statusNote:
      'A reviewer filed this from a research proposal. The quote is a lead. It does not by itself verify that this supplier supplies this customer.',
    evidence: ['proposal-source'],
    namingSources: [],
    sources,
  };
  link.flag = deriveFlag(link.input.origins);
  if (link.status === 'verified') {
    throw new Error('Research verify must not write a verified supply link.');
  }
  return link;
}

/**
 * @param {{ sourceUrl: string, addressSourceUrl?: string, quote: string, coordinates?: { geocodeSourceUrl: string }, fetchedAt?: string }} proposal
 * @param {string} today
 */
function linkSources(proposal, today) {
  const date = (proposal.fetchedAt || today).slice(0, 10);
  const sources = [
    {
      id: 'proposal-source',
      title: 'Page cited by the research proposal',
      publisher: publisherOf(proposal.sourceUrl),
      date,
      url: proposal.sourceUrl,
      kind: 'news',
      note: proposal.quote,
    },
  ];
  if (proposal.addressSourceUrl && proposal.addressSourceUrl !== proposal.sourceUrl) {
    sources.push({
      id: 'address-source',
      title: 'Page that states the street address',
      publisher: publisherOf(proposal.addressSourceUrl),
      date,
      url: proposal.addressSourceUrl,
      kind: 'reference',
      note: 'States the street address used for the pin.',
    });
  }
  if (coordinatesReady(proposal)) {
    sources.push({
      id: 'geocode-source',
      title: 'Geocode of the street address',
      publisher: 'OpenStreetMap Nominatim',
      date,
      url: proposal.coordinates.geocodeSourceUrl,
      kind: 'reference',
      note: 'Geocode of the sourced street address. A city centroid is not used.',
    });
  }
  return sources;
}

/**
 * @param {{ addressSourceUrl?: string, sourceUrl: string }} proposal
 */
function addressSourceIdFor(proposal) {
  if (proposal.addressSourceUrl && proposal.addressSourceUrl !== proposal.sourceUrl) return 'address-source';
  return 'proposal-source';
}

/**
 * @param {{ coordinates?: { address?: string, addressSourceUrl?: string, geocodeSourceUrl?: string, lat?: number, lng?: number }, supplier?: { address?: string }, addressSourceUrl?: string }} proposal
 */
function coordinatesReady(proposal) {
  const point = proposal.coordinates;
  if (!point) return false;
  if (!proposal.supplier?.address || point.address !== proposal.supplier.address) return false;
  if (!proposal.addressSourceUrl || point.addressSourceUrl !== proposal.addressSourceUrl) return false;
  if (!point.geocodeSourceUrl) return false;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

/**
 * @param {string} url
 */
function publisherOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown publisher';
  }
}

/**
 * @param {string} root
 */
function manufacturerSlugSet(root) {
  const dir = nodePath.join(root, 'src/data/manufacturers');
  const slugs = new Set();
  if (!existsSync(dir)) return slugs;
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json')) slugs.add(name.replace(/\.json$/, ''));
  }
  return slugs;
}

/**
 * @param {string} root
 */
function existingLinkFiles(root) {
  const dir = nodePath.join(root, 'src/data/supply-links');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      path: `src/data/supply-links/${name}`,
      raw: JSON.parse(readFileSync(nodePath.join(dir, name), 'utf8')),
    }));
}

/**
 * A draft profile for a named supplier that has a company site and no manufacturer file yet.
 * @param {{ supplier: { slug: string, name: string, identified: boolean, website?: string, address?: string, city?: string, region?: string, country?: string }, customer: { name: string }, input: { name: string }, quote: string, sourceUrl: string, addressSourceUrl?: string, coordinates?: { lat: number, lng: number, address: string, addressSourceUrl: string, geocodeSourceUrl: string } }} proposal
 * @param {string} today
 * @param {Set<string>} manufacturerSlugs
 */
export function draftProfileFor(proposal, today, manufacturerSlugs) {
  if (!proposal.supplier.identified) return null;
  if (!proposal.supplier.website) return null;
  if (manufacturerSlugs.has(proposal.supplier.slug)) return null;
  const sourceId = 'proposal-source';
  const host = publisherOf(proposal.supplier.website);
  const location =
    proposal.supplier.city && proposal.supplier.region
      ? {
          city: proposal.supplier.city,
          region: proposal.supplier.region,
          country: proposal.supplier.country === 'US' ? 'United States' : 'Unstated',
        }
      : { city: 'Unstated', region: 'Unstated', country: 'Unstated' };
  /** @type {Record<string, unknown>} */
  const profile = {
    slug: proposal.supplier.slug,
    name: proposal.supplier.name,
    legalName: proposal.supplier.name,
    featured: false,
    status: 'draft',
    categories: ['upstream-suppliers'],
    products: [{ name: proposal.input.name, category: 'upstream-suppliers' }],
    deck: `${proposal.supplier.name} is a supply lead from a public page. This draft is not a verified profile.`,
    lastReviewed: today,
    location,
    logo: {
      src: `/manufacturers/${proposal.supplier.slug}/mark.svg`,
      width: 600,
      height: 160,
      alt: `Placeholder mark for ${proposal.supplier.name}. The company's own logo is not on file.`.slice(0, 160),
    },
    website: proposal.supplier.website,
    websiteLabel: host,
    ownership: {
      code: 'unverified',
      label: 'Owner not established',
      short: 'No charter or ownership source was filed with this lead.',
      confidence: 'unverified',
    },
    manufacturing: {
      code: 'unverified',
      label: 'Plant not established',
      short: 'No plant inspection was filed with this lead.',
      confidence: 'unverified',
    },
    lede: [
      {
        text: `${proposal.supplier.name} was named on a public page as a possible supplier of ${proposal.input.name} to ${proposal.customer.name}. No charter was retrieved, so the legal name is the name on that page, not a filing. The sentence is a lead. It is not a verified supply link.`,
        sources: [sourceId],
      },
    ],
    sections: [
      {
        id: 'lead',
        kicker: 'Research lead',
        heading: 'What the page said',
        paragraphs: [{ text: proposal.quote, sources: [sourceId] }],
      },
    ],
    changelog: [
      {
        sortDate: today,
        dateLabel: today,
        title: 'Filed from a research proposal',
        text: 'A reviewer filed this draft from a supply proposal. It stays off the public list.',
        sources: [sourceId],
      },
    ],
    openQuestions: [
      {
        text: 'Ownership, the plant, and whether this company actually supplies the customer are not established. Coordinates are stored only when the page states a street address and a geocode cites that address.',
        sources: [sourceId],
      },
    ],
    sources: [
      {
        id: sourceId,
        title: `Page that named ${proposal.supplier.name}`,
        publisher: publisherOf(proposal.sourceUrl),
        url: proposal.sourceUrl,
        kind: 'news',
        note: 'Quoted in the research proposal. Not a verification that this company supplies the customer.',
      },
    ],
  };
  if (coordinatesReady(proposal)) {
    profile.sources.push({
      id: 'geocode-source',
      title: 'Geocode of the street address',
      publisher: 'OpenStreetMap Nominatim',
      url: proposal.coordinates.geocodeSourceUrl,
      kind: 'reference',
      note: 'Geocode of the sourced street address.',
    });
    profile.hq = {
      address: proposal.coordinates.address,
      ...(proposal.supplier.city ? { city: proposal.supplier.city } : {}),
      ...(proposal.supplier.region ? { region: proposal.supplier.region } : {}),
      country: 'US',
      lat: proposal.coordinates.lat,
      lng: proposal.coordinates.lng,
      coordinateSources: [sourceId, 'geocode-source'],
      status: 'sourced',
      sources: [sourceId],
      note: 'Street address from the cited page. The pin is the geocode of that address.',
    };
    profile.lede[0].sources = [sourceId, 'geocode-source'];
  } else if (proposal.supplier.address && proposal.addressSourceUrl && proposal.supplier.country === 'US') {
    const addressId = proposal.addressSourceUrl === proposal.sourceUrl ? sourceId : 'address-source';
    if (addressId !== sourceId) {
      profile.sources.push({
        id: addressId,
        title: 'Page that states the street address',
        publisher: publisherOf(proposal.addressSourceUrl),
        url: proposal.addressSourceUrl,
        kind: 'reference',
        note: 'States the street address. No coordinates are stored with it.',
      });
      profile.lede[0].sources = [sourceId, addressId];
    }
    profile.hq = {
      address: proposal.supplier.address,
      ...(proposal.supplier.city ? { city: proposal.supplier.city } : {}),
      ...(proposal.supplier.region ? { region: proposal.supplier.region } : {}),
      country: 'US',
      status: 'sourced',
      sources: [addressId],
      note: 'Street address as written on the source page. No coordinates until a geocode cites this address.',
    };
  }
  return profile;
}

/**
 * @param {string} root
 * @param {{ slug: string }} profile
 */
function writeDraftProfile(root, profile) {
  const dir = nodePath.join(root, 'src/data/manufacturers');
  mkdirSync(dir, { recursive: true });
  const path = nodePath.join(dir, `${profile.slug}.json`);
  if (existsSync(path)) throw new Error(`Manufacturer ${profile.slug} already exists.`);
  if (!path.startsWith(`${nodePath.resolve(dir)}${nodePath.sep}`)) throw new Error('Manufacturer path left the data directory.');
  writeJson(path, profile);
  const logoDir = nodePath.join(root, 'public/manufacturers', profile.slug);
  mkdirSync(logoDir, { recursive: true });
  writeFileSync(nodePath.join(logoDir, 'mark.svg'), placeholderMarkSvg());
}

export function placeholderMarkSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160" viewBox="0 0 600 160" role="img" aria-label="Draft supplier">
  <rect width="600" height="160" fill="#24362e"/>
  <text x="30" y="92" fill="#f3efe4" font-family="Georgia, serif" font-size="32">Draft supplier</text>
</svg>
`;
}

/**
 * @param {string} path
 * @param {unknown} value
 */
function writeJson(path, value) {
  mkdirSync(nodePath.dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
