import { readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { z } from 'zod';
import { placeIssues, placeSchema, placeSourceIds } from './places.mjs';

/**
 * One supply link (an edge on the map): supplier -> customer, for one input.
 *
 * A link is `verified` only when a source names this supplier as supplying this
 * customer (a supplier page, a filing, a customs record, a press release, or a
 * trade article). A company saying its steel "could come from" a mill is not
 * that. Everything else stays `unverified`. Never guess.
 */

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** Link ids join customer, supplier, and input with a double hyphen. */
const linkId = z.string().regex(/^[a-z0-9]+(?:--?[a-z0-9]+)*$/);

export const supplySourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    publisher: z.string().min(1),
    date: z.string().min(1).optional(),
    url: z.string().url(),
    kind: z.enum(['company', 'supplier', 'filing', 'customs', 'press-release', 'trade', 'news', 'government', 'reference']),
    note: z.string().min(1).optional(),
  })
  .strict();

const partySchema = z
  .object({
    slug,
    name: z.string().min(1).max(160),
    /** false when the source gives only a place or a description, not a company name. */
    identified: z.boolean(),
    website: z.string().url().optional(),
    hq: placeSchema,
    parent: z
      .object({
        name: z.string().min(1).max(160),
        hq: placeSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const supplyLinkSchema = z
  .object({
    id: linkId,
    lastReviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** `manufacturer`: a file in src/data/manufacturers. `supplier`: the supplier slug on another link. */
    customer: z
      .object({
        type: z.enum(['manufacturer', 'supplier']),
        slug,
        name: z.string().min(1).max(160),
      })
      .strict(),
    supplier: partySchema,
    input: z
      .object({
        /** Groups links that are alternative sources of the same input, for domestic-share counts. */
        key: slug,
        name: z.string().min(1).max(120),
        /** Where the input is made or extracted. One place, or several when it comes from more than one. */
        origins: z.array(placeSchema).min(1),
      })
      .strict(),
    /** 1 = direct supplier of a manufacturer on the site. Each step upstream adds one. */
    tier: z.number().int().min(1).max(12),
    /** Derived from input.origins. The build checks it. */
    flag: z.enum(['domestic', 'foreign', 'mixed', 'unknown']),
    /** Set when the link reaches the primary resource. */
    primaryResource: z.enum(['mine', 'mill', 'farm', 'forest', 'well', 'recycling']).optional(),
    status: z.enum(['verified', 'unverified']),
    statusNote: z.string().min(1).max(800),
    /** Sources that bear on the link at all. */
    evidence: z.array(z.string().min(1)).min(1),
    /** Sources that name this supplier as supplying this customer. Required for verified. */
    namingSources: z.array(z.string().min(1)).default([]),
    sources: z.array(supplySourceSchema).min(1),
  })
  .strict();

/**
 * @param {Array<{ country: string }>} origins
 * @returns {'domestic' | 'foreign' | 'mixed' | 'unknown'}
 */
export function deriveFlag(origins) {
  const countries = origins.map((place) => place.country);
  if (countries.some((country) => country === 'unknown')) {
    const known = countries.filter((country) => country !== 'unknown');
    if (known.some((country) => country === 'US') && known.some((country) => country !== 'US')) return 'mixed';
    return 'unknown';
  }
  const us = countries.filter((country) => country === 'US').length;
  if (us === countries.length) return 'domestic';
  if (us === 0) return 'foreign';
  return 'mixed';
}

/**
 * Where a link takes the chain outside the United States, for the map.
 * @param {z.infer<typeof supplyLinkSchema>} link
 */
export function exitsUs(link) {
  const reasons = [];
  if (link.flag === 'foreign' || link.flag === 'mixed') reasons.push('input made or extracted outside the US');
  if (link.supplier.hq.country !== 'US' && link.supplier.hq.country !== 'unknown') reasons.push('supplier headquartered outside the US');
  if (link.supplier.parent && link.supplier.parent.hq.country !== 'US' && link.supplier.parent.hq.country !== 'unknown') {
    reasons.push('supplier parent headquartered outside the US');
  }
  return reasons;
}

/**
 * Domestic share of a customer's inputs, counted by input line (input.key).
 * A line counts as domestic only when every link for it is domestic.
 * No value weighting: sources do not give values.
 * @param {Array<z.infer<typeof supplyLinkSchema>>} links
 * @param {string} customerSlug
 */
export function domesticShareByLine(links, customerSlug) {
  const lines = new Map();
  for (const link of links) {
    if (link.customer.slug !== customerSlug) continue;
    const flags = lines.get(link.input.key) ?? [];
    flags.push(link.flag);
    lines.set(link.input.key, flags);
  }
  let domestic = 0;
  let unknown = 0;
  for (const flags of lines.values()) {
    if (flags.every((flag) => flag === 'domestic')) domestic += 1;
    else if (flags.some((flag) => flag === 'unknown')) unknown += 1;
  }
  return { lines: lines.size, domestic, unknown, method: 'input lines' };
}

/**
 * Validate a list of parsed-or-raw link files against each other and the manufacturer slugs.
 * @param {Array<{ path: string, raw: unknown }>} files
 * @param {Set<string>} manufacturerSlugs
 * @returns {{ links: Array<z.infer<typeof supplyLinkSchema>>, issues: string[] }}
 */
export function validateSupplyLinks(files, manufacturerSlugs) {
  const issues = [];
  const links = [];
  for (const { path, raw } of files) {
    const parsed = supplyLinkSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) issues.push(`${path} ${issue.path.join('.')}: ${issue.message}`);
      continue;
    }
    const link = parsed.data;
    const fileId = nodePath.basename(path).replace(/\.json$/, '');
    if (fileId !== link.id) issues.push(`${path} must use id "${fileId}" so the filename and the record match.`);

    const sourceIds = new Set();
    for (const source of link.sources) {
      if (sourceIds.has(source.id)) issues.push(`${path} repeats source id "${source.id}".`);
      sourceIds.add(source.id);
    }
    const cited = new Set();
    const take = (ids, where) => {
      for (const id of ids) {
        if (!sourceIds.has(id)) issues.push(`${path} ${where} cites "${id}", which is not in sources.`);
        cited.add(id);
      }
    };
    const checkPlace = (place, where) => {
      for (const message of placeIssues(place)) issues.push(`${path} ${where}: ${message}`);
      take(placeSourceIds(place), where);
    };

    checkPlace(link.supplier.hq, 'supplier.hq');
    if (link.supplier.parent) checkPlace(link.supplier.parent.hq, 'supplier.parent.hq');
    link.input.origins.forEach((place, index) => checkPlace(place, `input.origins.${index}`));
    take(link.evidence, 'evidence');
    take(link.namingSources, 'namingSources');

    for (const id of sourceIds) {
      if (!cited.has(id)) issues.push(`${path} lists source "${id}" but never cites it.`);
    }

    const derived = deriveFlag(link.input.origins);
    if (link.flag !== derived) issues.push(`${path} flag is "${link.flag}" but input.origins make it "${derived}".`);

    if (link.status === 'verified') {
      if (!link.supplier.identified) issues.push(`${path} is verified but the supplier is not identified by name.`);
      if (link.namingSources.length === 0) {
        issues.push(`${path} is verified but no namingSources name this supplier for this customer.`);
      }
      if (link.supplier.hq.status !== 'sourced') issues.push(`${path} is verified but supplier.hq is unverified.`);
    }

    links.push(link);
  }

  const ids = new Set();
  for (const link of links) {
    if (ids.has(link.id)) issues.push(`Supply link id "${link.id}" is repeated.`);
    ids.add(link.id);
  }

  // Tier rules: a manufacturer's direct supplier is tier 1. A supplier's supplier is that tier + 1.
  const tiersBySupplier = new Map();
  for (const link of links) {
    const tiers = tiersBySupplier.get(link.supplier.slug) ?? new Set();
    tiers.add(link.tier);
    tiersBySupplier.set(link.supplier.slug, tiers);
  }
  for (const link of links) {
    if (link.customer.type === 'manufacturer') {
      if (!manufacturerSlugs.has(link.customer.slug)) {
        issues.push(`Supply link "${link.id}" names manufacturer "${link.customer.slug}", which has no file in src/data/manufacturers.`);
      }
      if (link.tier !== 1) issues.push(`Supply link "${link.id}" supplies a manufacturer directly, so tier must be 1.`);
    } else {
      const customerTiers = tiersBySupplier.get(link.customer.slug);
      if (!customerTiers) {
        issues.push(`Supply link "${link.id}" names supplier "${link.customer.slug}" as its customer, but no link has that supplier.`);
      } else if (!customerTiers.has(link.tier - 1)) {
        issues.push(`Supply link "${link.id}" is tier ${link.tier}, but "${link.customer.slug}" is not a tier ${link.tier - 1} supplier.`);
      }
    }
  }

  return { links, issues };
}

/**
 * Read src/data/supply-links/*.json and src/data/manufacturers/*.json from disk.
 * @param {string} root repository root
 */
export function loadSupplyLinksFromDisk(root) {
  const linkDir = nodePath.join(root, 'src/data/supply-links');
  const manufacturerDir = nodePath.join(root, 'src/data/manufacturers');
  const manufacturerSlugs = new Set(
    readdirSync(manufacturerDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, '')),
  );
  let names = [];
  try {
    names = readdirSync(linkDir).filter((name) => name.endsWith('.json'));
  } catch {
    names = [];
  }
  const files = names.sort().map((name) => {
    const path = `src/data/supply-links/${name}`;
    let raw;
    try {
      raw = JSON.parse(readFileSync(nodePath.join(linkDir, name), 'utf8'));
    } catch (error) {
      raw = { __parseError: error instanceof Error ? error.message : String(error) };
    }
    return { path, raw };
  });
  return validateSupplyLinks(files, manufacturerSlugs);
}
