import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { loadProposalsFromDisk, proposalSchema } from './supply-proposals.mjs';

/**
 * Low-cost supply research.
 * Reads a fixed allowlist of public URLs already cited in the repo,
 * plus src/data/research-allowlist/<manufacturer-id>.json,
 * stores a short excerpt, and writes proposals only.
 * It never writes src/data/supply-links. It does not call a model.
 * Nominatim runs only when geocode is requested, and only for a street address with a source.
 */

export const RESEARCH_USAGE = `Usage: npm run research -- --from <manufacturer-id> [--dry-run] [--fixture] [--out <dir>] [--geocode]
       npm run research -- --act verify|reject|needs-source --id <proposal-id>
       npm run research -- --check-sources [--id <proposal-id>]

--dry-run lists the allowlist and writes nothing.
--fixture reads src/data/research-fixtures and does not use the network.
--check-sources fetches each open proposal's live source page and records whether the quote is on it (sourceCheck).
--geocode asks Nominatim for a street address that already has a source URL. It is off unless you pass this flag.`;

const EXCERPT_LIMIT = 800;
const EXCERPT_CAP = 1600;
const COMPANY_KINDS = new Set(['company', 'press-release', 'filing', 'trade', 'supplier']);

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA',
  'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
]);

const NAME_STOP = new Set([
  'a', 'an', 'the', 'steel', 'company', 'mill', 'plant', 'united', 'states', 'america', 'american', 'inc', 'llc', 'co',
]);

const NAME = '([^.;,\\n]{2,80})';
const RULES = [
  { re: new RegExp(`\\bcould come from\\s+${NAME}`, 'gi'), confidence: 'low' },
  { re: new RegExp(`\\b(?:might come from|may come from)\\s+${NAME}`, 'gi'), confidence: 'low' },
  {
    re: new RegExp(
      `\\b(?:supplied by|purchased from|bought from|sourced from|buys(?:\\s+\\w+){0,4}\\s+from)\\s+${NAME}`,
      'gi',
    ),
    confidence: 'medium',
  },
  {
    re: /\bthank you,?\s+(?:["“”']?family-owned["“”']?\s+)?([^.;\n]{2,80}?)(?:,\s*|\s+)for (?:also )?being (?:a )?reliable suppliers?/gi,
    confidence: 'medium',
  },
];

const ADDRESS_RE =
  /(\d{1,6}\s+[A-Za-z0-9.'#/-]+(?:\s+[A-Za-z0-9.'#/-]+){0,6}),\s*([A-Za-z .'-]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/;

/**
 * @param {string[]} argv
 */
export function parseResearchArgs(argv) {
  const args = argv.slice(2);
  /** @type {{ from?: string, dryRun: boolean, fixture: boolean, geocode: boolean, checkSources: boolean, out?: string, act?: string, id?: string, help: boolean }} */
  const parsed = { dryRun: false, fixture: false, geocode: false, checkSources: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--fixture') parsed.fixture = true;
    else if (arg === '--geocode') parsed.geocode = true;
    else if (arg === '--check-sources') parsed.checkSources = true;
    else if (arg === '--from') parsed.from = args[++index];
    else if (arg.startsWith('--from=')) parsed.from = arg.slice('--from='.length);
    else if (arg === '--out') parsed.out = args[++index];
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--act') parsed.act = args[++index];
    else if (arg.startsWith('--act=')) parsed.act = arg.slice('--act='.length);
    else if (arg === '--id') parsed.id = args[++index];
    else if (arg.startsWith('--id=')) parsed.id = arg.slice('--id='.length);
    else throw new Error(`Unknown argument ${arg}. ${RESEARCH_USAGE}`);
  }
  return parsed;
}

/**
 * @param {string} value
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

/**
 * @param {string} url
 */
export function isSecPatentOrTradeUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'sec.gov' || host.endsWith('.sec.gov')) return true;
    if (host === 'uspto.gov' || host.endsWith('.uspto.gov')) return true;
    if (host === 'patents.google.com') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Fixed allowlist: the company site, company and made-in-USA pages, and SEC, patent, or trade URLs already cited.
 * Extra trade, patent, and filing URLs come from src/data/research-allowlist/. Page links are not followed.
 * @param {{ manufacturer: { slug?: string, website?: string, sources?: Array<{ url?: string, kind?: string, title?: string }> }, links: Array<{ customer?: { slug?: string }, sources?: Array<{ url?: string, kind?: string, title?: string }> }> }} record
 * @param {Array<{ url?: string, why?: string }>} [extras]
 */
export function allowlistFor(record, extras = []) {
  const manufacturer = record.manufacturer;
  /** @type {Array<{ url: string, why: string }>} */
  const rows = [];
  const seen = new Set();
  const push = (value, why) => {
    const url = safeHttpUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    rows.push({ url, why });
  };
  if (manufacturer?.website) push(manufacturer.website, 'company website');
  const take = (source) => {
    if (!source || typeof source.url !== 'string') return;
    const kind = source.kind || '';
    if (COMPANY_KINDS.has(kind)) push(source.url, kind);
    else if (isSecPatentOrTradeUrl(source.url)) push(source.url, 'sec, patent, or trade url');
  };
  for (const source of manufacturer?.sources || []) take(source);
  for (const link of record.links || []) {
    if (link?.customer?.slug !== manufacturer?.slug) continue;
    for (const source of link.sources || []) take(source);
  }
  for (const extra of extras) push(extra?.url, extra?.why || 'research allowlist');
  return rows;
}

/**
 * Hand-checked trade, patent, and filing URLs for one manufacturer.
 * Missing file means no extras. A present file must be JSON.
 * @param {string} root
 * @param {string} slug
 */
export function extraAllowlist(root, slug) {
  const path = nodePath.join(root, 'src/data/research-allowlist', `${slug}.json`);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed?.urls;
  if (!Array.isArray(rows)) return [];
  /** @type {Array<{ url: string, why: string }>} */
  const extras = [];
  for (const row of rows) {
    if (typeof row === 'string') extras.push({ url: row, why: 'research allowlist' });
    else if (row && typeof row.url === 'string') extras.push({ url: row.url, why: row.why || 'research allowlist' });
  }
  return extras;
}

/**
 * @param {string} html
 * @param {number} [limit]
 */
export function htmlToExcerpt(html, limit = EXCERPT_LIMIT) {
  let source = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  const article = source.match(/<article(?:\s[^>]*)?>[\s\S]*?<\/article>/i);
  const main = source.match(/<main(?:\s[^>]*)?>[\s\S]*?<\/main>/i);
  if (article) source = article[0];
  else if (main) source = main[0];
  const text = decodeEntities(source.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (limit !== EXCERPT_LIMIT) return text.slice(0, limit);
  const slice = text.slice(0, limit);
  const ends = sentenceEnds(slice);
  let excerpt = ends.length ? slice.slice(0, ends[ends.length - 1]).trim() : slice;
  for (const tail of evidenceTails(text, excerpt)) {
    const glue = /[.!?]["”']?$/.test(excerpt) ? ' ' : '. ';
    const next = `${excerpt}${glue}${tail}`.trim();
    if (next.length > EXCERPT_CAP) break;
    excerpt = next;
  }
  return excerpt;
}

/**
 * @param {string} value
 */
function decodeEntities(value) {
  return value
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&ndash;|&#8211;|&#x2013;/gi, '-')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '-')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;|&#x201c;|&#x201d;/gi, '"')
    .replace(/&lsquo;|&rsquo;|&#8216;|&#8217;|&#x2018;|&#x2019;/gi, "'");
}

/**
 * Sentences past the lead that name a supplier, plus a short owner or product window.
 * @param {string} text
 * @param {string} lead
 */
function evidenceTails(text, lead) {
  /** @type {string[]} */
  const tails = [];
  const push = (snippet) => {
    const clean = snippet.replace(/\s+/g, ' ').trim();
    if (!clean || lead.includes(clean) || tails.includes(clean)) return;
    tails.push(clean);
  };
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    for (const match of text.matchAll(re)) {
      const sentence = sentenceAt(text, match.index ?? 0);
      if (!lead.includes(sentence)) push(sentence);
    }
  }
  const flat = text.search(/\bflatware\b|\bstainless\b/i);
  if (flat >= lead.length) push(text.slice(Math.max(0, flat - 40), flat + 80));
  const owner = text.search(/owner name:|sherrill manufacturing/i);
  if (owner >= lead.length) push(text.slice(Math.max(0, owner - 24), owner + 90));
  return tails;
}

/**
 * @param {string} name
 */
export function slugifyName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * @param {string} raw
 */
export function cleanSupplierName(raw) {
  const cut = raw.split(/\s+(?:or|and)\s+|,/)[0] ?? '';
  const name = cut.replace(/["“”]+/g, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/g, '');
  if (!name || !/^[A-Z0-9]/.test(name)) return '';
  const words = name.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 8) return '';
  if (words.length === 1 && words[0].length < 3) return '';
  if (words.every((word) => NAME_STOP.has(word.toLowerCase().replace(/\./g, '')))) return '';
  return name;
}

/**
 * @param {string} sentence
 */
/**
 * @param {string} raw
 */
export function supplierNames(raw) {
  /** @type {string[]} */
  const names = [];
  for (const piece of String(raw).split(/\s+and\s+/i)) {
    const name = cleanSupplierName(piece);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * @param {string} sentence
 */
export function inputFromSentence(sentence) {
  const text = sentence.toLowerCase();
  if (/\bbuffs?\b/.test(text) || text.includes('buffing')) return { key: 'buffing-compounds', name: 'buffing compounds' };
  if (text.includes('packag')) return { key: 'packaging', name: 'packaging' };
  if (text.includes('stainless') || text.includes('steel')) return { key: 'stainless-steel', name: 'stainless steel' };
  return { key: 'unspecified', name: 'unspecified input' };
}

/**
 * @param {string} text
 */
export function streetAddressIn(text) {
  const match = text.match(ADDRESS_RE);
  if (!match) return null;
  const region = match[3];
  if (!US_STATES.has(region)) return null;
  return {
    address: match[0].replace(/\s+/g, ' ').trim(),
    city: match[2].trim(),
    region,
    country: 'US',
  };
}

/**
 * @param {string} name
 * @param {string} supplierSlug
 * @param {Array<{ slug: string, name: string }>} known
 */
export function isKnownSupplier(name, supplierSlug, known) {
  const norm = name.toLowerCase();
  for (const item of known) {
    if (item.slug === supplierSlug) return true;
    const other = item.name.toLowerCase();
    if (norm.length >= 4 && (other.includes(norm) || norm.includes(other))) return true;
  }
  return false;
}

/**
 * @param {{ excerpt: string, sourceUrl: string, customer: { slug: string, name: string }, knownSuppliers: Array<{ slug: string, name: string }>, fetchedAt?: string }} input
 */
export function extractProposals(input) {
  const excerpt = input.excerpt || '';
  /** @type {Map<string, ReturnType<typeof proposalSchema.parse>>} */
  const byId = new Map();
  const rank = { low: 1, medium: 2, high: 3 };
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    for (const match of excerpt.matchAll(re)) {
      const names = supplierNames(match[1] || '');
      if (names.length === 0) continue;
      const index = match.index ?? 0;
      const sentence = sentenceAt(excerpt, index);
      const previous = previousSentence(excerpt, index);
      const product = inputFromSentence(`${previous} ${sentence}`);
      const naming = inputFromSentence(sentence);
      const quote = (
        product.key !== 'unspecified' &&
        naming.key === 'unspecified' &&
        previous &&
        inputFromSentence(previous).key === product.key
          ? `${previous} ${sentence}`
          : sentence
      ).slice(0, 500);
      for (const name of names) {
      const supplierSlug = slugifyName(name);
      if (!supplierSlug || isKnownSupplier(name, supplierSlug, input.knownSuppliers)) continue;
      const id = `${input.customer.slug}--${supplierSlug}--${product.key}`;
      const website = websiteIn(sentence);
      const address = streetAddressIn(sentence);
      /** @type {Record<string, unknown>} */
      const proposal = {
        id,
        status: 'open',
        customer: input.customer,
        supplier: {
          slug: supplierSlug,
          name,
          identified: true,
          ...(website ? { website } : {}),
        },
        input: product,
        tierHint: 1,
        quote,
        sourceUrl: input.sourceUrl,
        confidence: rule.confidence,
        ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
      };
      const existing = byId.get(id);
      if (!existing || rank[rule.confidence] > rank[existing.confidence]) byId.set(id, proposal);
      else continue;
      if (address) {
        proposal.supplier.address = address.address;
        proposal.supplier.city = address.city;
        proposal.supplier.region = address.region;
        proposal.supplier.country = address.country;
        proposal.addressSourceUrl = input.sourceUrl;
      }
      }
    }
  }
  if (byId.size === 1) {
    const only = [...byId.values()][0];
    const pageAddress = streetAddressIn(excerpt);
    if (pageAddress && !only.supplier.address) {
      only.supplier.address = pageAddress.address;
      only.supplier.city = pageAddress.city;
      only.supplier.region = pageAddress.region;
      only.supplier.country = pageAddress.country;
      only.addressSourceUrl = input.sourceUrl;
    }
    const pageSite = websiteIn(excerpt);
    if (pageSite && !only.supplier.website) only.supplier.website = pageSite;
  }
  return [...byId.values()].map((proposal) => proposalSchema.parse(proposal));
}

/**
 * @param {string} text
 * @param {number} index
 */
/**
 * Index just after each sentence end. A closing quote counts as part of the sentence.
 * @param {string} text
 */
function sentenceEnds(text) {
  /** @type {number[]} */
  const ends = [];
  for (const match of text.matchAll(/[.!?]["”']?(?=\s|$)/g)) {
    ends.push((match.index ?? 0) + match[0].length);
  }
  return ends;
}

/**
 * @param {string} text
 * @param {number} index
 */
function sentenceAt(text, index) {
  const ends = sentenceEnds(text);
  let from = 0;
  let to = text.length;
  for (const end of ends) {
    if (end <= index) from = end;
    else {
      to = end;
      break;
    }
  }
  return text.slice(from, to).trim();
}

/**
 * @param {string} text
 * @param {number} index
 */
function previousSentence(text, index) {
  const ends = sentenceEnds(text);
  let prior = 0;
  let start = 0;
  for (const end of ends) {
    if (end <= index) {
      prior = start;
      start = end;
    } else break;
  }
  if (start === 0) return '';
  return text.slice(prior, start).trim();
}

/**
 * @param {string} sentence
 */
function websiteIn(sentence) {
  const match = sentence.match(/company site is\s+(https?:\/\/[^\s]+)/i);
  if (!match) return '';
  return safeHttpUrl(match[1].replace(/[),.;]+$/g, ''));
}

/**
 * Nominatim, and only for a street address that already has a source.
 * A result without a house number is refused.
 * @param {{ address?: string, addressSourceUrl?: string, fetchImpl?: typeof fetch }} input
 */
export async function geocodeStreetAddress(input) {
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  const addressSourceUrl = safeHttpUrl(input.addressSourceUrl || '');
  if (!address || !/\d/.test(address) || !streetAddressIn(address)) {
    return { ok: false, reason: 'no-street-address' };
  }
  if (!addressSourceUrl) return { ok: false, reason: 'no-address-source' };
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'AmericanForgeResearch/1.0 (+https://americanforge.fyi)',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, reason: 'geocode-failed' };
  }
  if (!response.ok) return { ok: false, reason: 'geocode-failed' };
  let rows;
  try {
    rows = await response.json();
  } catch {
    return { ok: false, reason: 'geocode-failed' };
  }
  const hit = Array.isArray(rows) ? rows[0] : null;
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  const house = hit?.address?.house_number;
  const road = hit?.address?.road;
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng) || !house || !road) {
    return { ok: false, reason: 'not-a-street' };
  }
  return {
    ok: true,
    lat,
    lng,
    geocodeSourceUrl: url.href,
    addressSourceUrl,
    address,
  };
}

/**
 * @param {string} root
 * @param {string} slug
 */
export function loadManufacturerRecord(root, slug) {
  const manufacturerPath = nodePath.join(root, 'src/data/manufacturers', `${slug}.json`);
  if (!existsSync(manufacturerPath)) return null;
  const manufacturer = JSON.parse(readFileSync(manufacturerPath, 'utf8'));
  const linkDir = nodePath.join(root, 'src/data/supply-links');
  /** @type {unknown[]} */
  const links = [];
  if (existsSync(linkDir)) {
    for (const name of readdirSync(linkDir).sort()) {
      if (!name.endsWith('.json')) continue;
      links.push(JSON.parse(readFileSync(nodePath.join(linkDir, name), 'utf8')));
    }
  }
  return { manufacturer, links };
}

/**
 * @param {string} root
 * @param {string} slug
 */
function fixturePages(root, slug) {
  const path = nodePath.join(root, 'src/data/research-fixtures', `${slug}.json`);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed.pages) ? parsed.pages : [];
}

/**
 * @param {{ root: string, writeRoot?: string, from: string, dryRun?: boolean, fixture?: boolean, geocode?: boolean, fetchImpl?: typeof fetch, now?: Date }} options
 */
export async function runResearch(options) {
  const record = loadManufacturerRecord(options.root, options.from);
  if (!record) throw new Error(`No manufacturer file for ${options.from}.`);
  const allowlist = allowlistFor(record, extraAllowlist(options.root, options.from));
  if (options.dryRun) {
    return { dryRun: true, allowlist, proposals: [], wrote: [] };
  }
  const writeRoot = options.writeRoot || options.root;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const fixtures = options.fixture ? fixturePages(options.root, options.from) : [];
  const fixtureByUrl = new Map(fixtures.map((page) => [safeHttpUrl(page.url), page]));
  /** @type {Array<{ url: string, fetchedAt: string, ok: boolean, excerpt: string, status?: number }>} */
  const cache = [];
  for (const row of allowlist) {
    if (options.fixture) {
      const page = fixtureByUrl.get(row.url);
      cache.push({
        url: row.url,
        fetchedAt,
        ok: Boolean(page),
        excerpt: page ? htmlToExcerpt(page.html || page.excerpt || '') : '',
        status: page ? 200 : 0,
      });
      continue;
    }
    cache.push(await fetchExcerpt(row.url, options.fetchImpl ?? globalThis.fetch, fetchedAt));
  }
  const knownSuppliers = [];
  for (const link of record.links) {
    if (link?.customer?.slug !== options.from || !link.supplier) continue;
    knownSuppliers.push({ slug: link.supplier.slug, name: link.supplier.name });
  }
  /** @type {ReturnType<typeof extractProposals>} */
  let proposals = [];
  for (const page of cache) {
    if (!page.ok || !page.excerpt) continue;
    proposals.push(
      ...extractProposals({
        excerpt: page.excerpt,
        sourceUrl: page.url,
        customer: { slug: record.manufacturer.slug, name: record.manufacturer.name },
        knownSuppliers,
        fetchedAt,
      }),
    );
  }
  proposals = dedupeProposals(proposals);
  if (options.geocode) {
    for (const proposal of proposals) {
      if (!proposal.supplier.address || !proposal.addressSourceUrl) continue;
      const coded = await geocodeStreetAddress({
        address: proposal.supplier.address,
        addressSourceUrl: proposal.addressSourceUrl,
        fetchImpl: options.fetchImpl,
      });
      if (!coded.ok) continue;
      proposal.coordinates = {
        lat: coded.lat,
        lng: coded.lng,
        address: proposal.supplier.address,
        addressSourceUrl: proposal.addressSourceUrl,
        geocodeSourceUrl: coded.geocodeSourceUrl,
      };
    }
  }
  const wrote = writeResearchOutput(writeRoot, options.from, cache, proposals);
  return { dryRun: false, allowlist, proposals, wrote };
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @param {string} fetchedAt
 */
async function fetchExcerpt(url, fetchImpl, fetchedAt) {
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'AmericanForgeResearch/1.0 (+https://americanforge.fyi)',
      },
    });
    if (!response.ok) return { url, fetchedAt, ok: false, excerpt: '', status: response.status };
    const html = await response.text();
    return { url, fetchedAt, ok: true, excerpt: htmlToExcerpt(html), status: response.status };
  } catch {
    return { url, fetchedAt, ok: false, excerpt: '', status: 0 };
  }
}

/**
 * @param {Array<z.infer<typeof proposalSchema>>} proposals
 */
function dedupeProposals(proposals) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  const rank = { low: 1, medium: 2, high: 3 };
  for (const proposal of proposals) {
    const previous = byId.get(proposal.id);
    if (!previous || rank[proposal.confidence] > rank[previous.confidence]) byId.set(proposal.id, proposal);
  }
  return [...byId.values()];
}

/**
 * @param {string} writeRoot
 * @param {string} slug
 * @param {Array<{ url: string, fetchedAt: string, ok: boolean, excerpt: string, status?: number }>} cache
 * @param {Array<Record<string, unknown>>} proposals
 */
function writeResearchOutput(writeRoot, slug, cache, proposals) {
  /** @type {string[]} */
  const wrote = [];
  const cacheDir = nodePath.join(writeRoot, 'src/data/research-cache', slug);
  mkdirSync(cacheDir, { recursive: true });
  for (const page of cache) {
    const name = createHash('sha256').update(page.url).digest('hex').slice(0, 16);
    const path = nodePath.join(cacheDir, `${name}.json`);
    writeFileSync(path, `${JSON.stringify(page, null, 2)}\n`);
    wrote.push(path);
  }
  const proposalDir = nodePath.join(writeRoot, 'src/data/supply-proposals');
  mkdirSync(proposalDir, { recursive: true });
  let existing = [];
  try {
    existing = loadProposalsFromDisk(writeRoot).proposals;
  } catch {
    existing = [];
  }
  const kept = new Map(existing.map((proposal) => [proposal.id, proposal]));
  for (const proposal of proposals) {
    const previous = kept.get(proposal.id);
    if (previous && previous.status !== 'open') continue;
    const path = nodePath.join(proposalDir, `${proposal.id}.json`);
    writeFileSync(path, `${JSON.stringify(proposal, null, 2)}\n`);
    wrote.push(path);
  }
  return wrote;
}
