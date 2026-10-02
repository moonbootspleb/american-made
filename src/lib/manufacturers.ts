import { existsSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  draftManufacturers,
  isPublishedManufacturer,
  publishedManufacturers,
} from './publication.mjs';

const sourceKind = z.enum(['company', 'news', 'government', 'reference']);

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  date: z.string().min(1).optional(),
  url: z.string().url(),
  kind: sourceKind,
  note: z.string().min(1).optional(),
});

const confidence = z.enum(['reported', 'partial', 'unverified']);

const ownershipCode = z.enum([
  'american-owned-and-run',
  'not-american-owned-and-run',
  'unverified',
]);

const manufacturingCode = z.enum([
  'made-in-usa',
  'not-made-in-usa',
  'split',
  'unverified',
]);

const inputsCode = z.enum(['american', 'partial', 'not-american', 'unknown']);

export const inputOriginSchema = z.enum(['us', 'foreign', 'mixed', 'unknown']);

export type InputOrigin = z.infer<typeof inputOriginSchema>;

const inputComponentSchema = z.object({
  name: z.string().min(1).max(80),
  percent: z.number().positive().max(100),
  origin: inputOriginSchema,
  note: z.string().min(1).max(160).optional(),
});

export function inputComponentsTotal(components: { percent: number }[]): number {
  return components.reduce((total, component) => total + component.percent, 0);
}

/**
 * A scored inputs line needs a component list that totals exactly 100.
 * `unknown` may omit the list. A list that is present always has to total 100.
 */
export function inputComponentListIssues(inputs: {
  code: string;
  components?: { percent: number }[];
}): string[] {
  const issues: string[] = [];
  const components = inputs.components;
  if (inputs.code !== 'unknown' && (!components || components.length === 0)) {
    issues.push(
      'When inputs is present and not unknown, components must total exactly 100. Omit inputs when that list is not established.',
    );
  }
  if (components && components.length > 0) {
    const total = inputComponentsTotal(components);
    if (total !== 100) {
      issues.push(`Input components must total exactly 100. They total ${total}.`);
    }
  }
  return issues;
}

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  }, 'Use an http or https URL with a host.');

const logoSchema = z.object({
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().min(1).max(160),
});

/**
 * A real affiliate or partner link, when one already exists.
 * Do not invent a program or a URL. Omit the object when there is none.
 */
const affiliateSchema = z.object({
  url: httpUrl,
  disclosure: z.string().min(1).max(400),
  network: z.string().min(1).max(80).optional(),
});

/**
 * A photograph of goods the company published.
 * The file lives under `public/manufacturers/<slug>/`.
 * `credit` names the publisher. `sourceUrl` is the page it came from.
 * Do not point this at a stock picture.
 */
const galleryImageSchema = z.object({
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().min(1).max(200),
  caption: z.string().min(1).max(120).optional(),
  credit: z.string().min(1).max(160),
  sourceUrl: httpUrl,
});

export const categorySchema = z.object({
  slug,
  name: z.string().min(1),
  description: z.string().min(1),
  shopper: z.string().min(1),
});

const cited = z.object({
  text: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});

export const manufacturerSchema = z.object({
  slug,
  name: z.string().min(1),
  legalName: z.string().min(1),
  featured: z.boolean(),
  /**
   * `draft` stays off the public list, the category shelves, and
   * `/manufacturers/<slug>`. Omit this field, or set `published`, to put the
   * company on the list. An admin reads a draft at
   * `/admin/preview/manufacturers/<slug>` after signing in at `/admin/login`.
   */
  status: z.enum(['published', 'draft']).default('published'),
  categories: z.array(slug).min(1),
  products: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        category: slug,
      }),
    )
    .min(1),
  deck: z.string().min(1),
  lastReviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.object({
    city: z.string().min(1),
    region: z.string().min(1),
    country: z.string().min(1),
    publicContact: z.string().min(1).optional(),
    publicContactNote: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
  }),
  /**
   * Company mark on the list card and the profile header.
   *
   * `src` is a site path to a file under `public/manufacturers/<slug>/`
   * (png, jpg, jpeg, webp, gif, or svg). The build fails when that file is
   * not on disk. For a raster file, `width` and `height` are the pixel size
   * of that file. An SVG still needs both so the page can reserve space.
   * `alt` names the mark.
   */
  logo: logoSchema,
  /** The company’s own site. Required. This is not an affiliate URL. */
  website: httpUrl,
  websiteLabel: z.string().min(1),
  /**
   * Optional paid outbound link. Set this only when a real affiliate or
   * partner URL is already known. Do not invent a program or a URL.
   *
   * When present, the card, the profile header, and the bottom company
   * button use `url` instead of `website`. `disclosure` is the plain-language
   * note shown beside those links only. `network` is an optional program
   * label. The profile’s Official site line always stays on `website`.
   */
  affiliate: affiliateSchema.optional(),
  /**
   * Optional photographs of goods the company has published.
   * Omit the array when none are filed. An empty array is invalid.
   * At most eight. Do not invent a stock photo. Each `src` is a file
   * under `public/manufacturers/<slug>/`, and width and height match it.
   */
  gallery: z.array(galleryImageSchema).min(1).max(8).optional(),
  ownership: z.object({
    code: ownershipCode,
    label: z.string().min(1),
    short: z.string().min(1),
    confidence,
  }),
  manufacturing: z.object({
    code: manufacturingCode,
    label: z.string().min(1),
    short: z.string().min(1),
    confidence,
  }),
  /**
   * Where the materials come from. Omit the object when that is not established.
   * When `code` is not `unknown`, `components` is required and the shares must
   * total exactly 100. `unknown` may omit the list. Do not invent shares.
   * Each component is a name, a percent, and an origin (`us`, `foreign`,
   * `mixed`, or `unknown`). `note` is an optional short limit on that row.
   * The rating derives the inputs level from the component origins when a list
   * is present. An unknown code or unverified confidence still leaves the line out.
   */
  inputs: z
    .object({
      code: inputsCode,
      label: z.string().min(1).max(80),
      short: z.string().min(1).max(320),
      confidence,
      sources: z.array(z.string().min(1)).min(1),
      components: z.array(inputComponentSchema).min(1).optional(),
    })
    .superRefine((inputs, ctx) => {
      for (const message of inputComponentListIssues(inputs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['components'],
          message,
        });
      }
    })
    .optional(),
  /**
   * Optional shop note for an American-founded, American-owned, American-run
   * manufacturer whose plant is heavily automated.
   *
   * Omit the object when that is not established. Do not set
   * `heavilyAutomated` to false: absence means "not established," not
   * "verified as a hand shop."
   *
   * The note is a sourced fact. It is not a warning, and it must not change
   * list order or keep a company off the list. `label` is the short stamp
   * (for example "Heavily automated"). `note` is one or two concrete sentences.
   * `sources` must cite ids in `sources` and are required whenever the object
   * is present.
   */
  automation: z
    .object({
      heavilyAutomated: z.boolean(),
      label: z.string().min(1).max(40),
      note: z.string().min(1).max(320),
      sources: z.array(z.string().min(1)).min(1),
    })
    .optional(),
  lede: z.array(cited).min(1),
  sections: z
    .array(
      z.object({
        id: z.string().min(1),
        kicker: z.string().min(1),
        heading: z.string().min(1),
        paragraphs: z.array(cited).min(1),
      }),
    )
    .min(1),
  changelog: z
    .array(
      z.object({
        sortDate: z.string().min(1),
        dateLabel: z.string().min(1),
        title: z.string().min(1),
        text: z.string().min(1),
        sources: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
  openQuestions: z.array(cited).min(1),
  sources: z.array(sourceSchema).min(1),
});

export type Manufacturer = z.infer<typeof manufacturerSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CitedBlock = z.infer<typeof cited>;

const categoryModules = import.meta.glob('../data/categories/*.json', {
  eager: true,
  import: 'default',
});

function loadCategories(): Category[] {
  const categories = Object.entries(categoryModules).map(([path, raw]) => {
    const parsed = categorySchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid category ${path}\n${detail}`);
    }
    const fileSlug = path.split('/').pop()?.replace(/\.json$/, '');
    if (fileSlug !== parsed.data.slug) {
      throw new Error(
        `${path} must use slug "${fileSlug}" so the filename and the shelf match. Found "${parsed.data.slug}".`,
      );
    }
    return parsed.data;
  });

  const seen = new Set<string>();
  for (const category of categories) {
    if (seen.has(category.slug)) {
      throw new Error(`Category slug "${category.slug}" is repeated.`);
    }
    seen.add(category.slug);
  }

  return categories.sort((a, b) => a.name.localeCompare(b.name));
}

const categories = loadCategories();
const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));

const modules = import.meta.glob('../data/manufacturers/*.json', {
  eager: true,
  import: 'default',
});

function loadManufacturers(): Manufacturer[] {
  const profiles = Object.entries(modules).map(([path, raw]) => {
    const parsed = manufacturerSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid manufacturer profile ${path}\n${detail}`);
    }

    const profile = parsed.data;
    const fileSlug = path.split('/').pop()?.replace(/\.json$/, '');
    if (fileSlug !== profile.slug) {
      throw new Error(
        `${path} must use slug "${fileSlug}" so the filename and the record match. Found "${profile.slug}".`,
      );
    }

    for (const message of logoFileIssues(profile)) {
      throw new Error(`${path} ${message}`);
    }

    if (profile.gallery) {
      const gallerySrcs = new Set<string>();
      for (const image of profile.gallery) {
        if (gallerySrcs.has(image.src)) {
          throw new Error(`${path} repeats gallery image "${image.src}".`);
        }
        gallerySrcs.add(image.src);
        for (const message of imageFileIssues(profile.slug, image, 'gallery')) {
          throw new Error(`${path} ${message}`);
        }
      }
    }

    const sourceIds = new Set<string>();
    for (const source of profile.sources) {
      if (sourceIds.has(source.id)) {
        throw new Error(`${path} repeats source id "${source.id}".`);
      }
      sourceIds.add(source.id);
    }

    const citedIds = new Set<string>();
    const take = (ids: string[], where: string) => {
      for (const id of ids) {
        if (!sourceIds.has(id)) {
          throw new Error(`${path} ${where} cites unknown source "${id}".`);
        }
        citedIds.add(id);
      }
    };

    for (const block of profile.lede) take(block.sources, 'lede');
    for (const section of profile.sections) {
      for (const block of section.paragraphs) {
        take(block.sources, `section ${section.id}`);
      }
    }
    for (const entry of profile.changelog) {
      take(entry.sources, `changelog ${entry.sortDate}`);
    }
    for (const block of profile.openQuestions) {
      take(block.sources, 'open question');
    }
    const categorySlugs = new Set<string>();
    for (const categorySlug of profile.categories) {
      if (!categoryBySlug.has(categorySlug)) {
        throw new Error(`${path} uses unknown category "${categorySlug}". Add src/data/categories/${categorySlug}.json.`);
      }
      if (categorySlugs.has(categorySlug)) {
        throw new Error(`${path} repeats category "${categorySlug}".`);
      }
      categorySlugs.add(categorySlug);
    }
    const productNames = new Set<string>();
    for (const product of profile.products) {
      if (!categorySlugs.has(product.category)) {
        throw new Error(
          `${path} lists "${product.name}" under "${product.category}", which is not one of this manufacturer's categories.`,
        );
      }
      const key = product.name.toLowerCase();
      if (productNames.has(key)) {
        throw new Error(`${path} repeats product "${product.name}".`);
      }
      productNames.add(key);
    }

    if (profile.inputs) {
      take(profile.inputs.sources, 'inputs');
      for (const message of inputComponentListIssues(profile.inputs)) {
        throw new Error(`${path} ${message}`);
      }
    }
    if (profile.automation) {
      if (!profile.automation.heavilyAutomated) {
        throw new Error(
          `${path} sets automation.heavilyAutomated to false. Omit automation when it is not established.`,
        );
      }
      if (profile.ownership.code !== 'american-owned-and-run') {
        throw new Error(
          `${path} has an automation note, which is only for a company already recorded as American-owned and American-run. Ownership code is "${profile.ownership.code}".`,
        );
      }
      take(profile.automation.sources, 'automation note');
    }

    for (const id of sourceIds) {
      if (!citedIds.has(id)) {
        throw new Error(`${path} lists source "${id}" but never cites it.`);
      }
    }

    return profile;
  });

  // Alphabetical by name. Rating, category, `featured`, and `automation` do not change order.
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Logo checks read public/ next to this file. The Netlify adapter bundles the
 * server build under .netlify/, so that relative URL no longer reaches public/.
 * Fall back to the project directory, which is the working directory at build time.
 */
function resolvePublicRoot(): string {
  const fromModule = nodePath.resolve(fileURLToPath(new URL('../../public', import.meta.url)));
  if (existsSync(fromModule)) return fromModule;
  return nodePath.resolve(process.cwd(), 'public');
}

const publicRoot = resolvePublicRoot();
const logoExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

const manufacturers = loadManufacturers();

export function getAllCategories(): Category[] {
  return categories;
}

/** Shelves that have at least one published manufacturer. Draft-only shelves stay off the public site. */
export function getPublicCategories(): Category[] {
  const used = new Set<string>();
  for (const profile of manufacturers) {
    if (!isPublishedManufacturer(profile)) continue;
    for (const categorySlug of profile.categories) used.add(categorySlug);
  }
  return categories.filter((category) => used.has(category.slug));
}

export function getCategory(slug: string): Category | undefined {
  return categoryBySlug.get(slug);
}

export function categoryNameList(profile: Manufacturer): string {
  return profile.categories
    .map((slug) => categoryBySlug.get(slug)?.name ?? slug)
    .join(', ');
}

export function getAllManufacturers(): Manufacturer[] {
  return publishedManufacturers(manufacturers);
}

export function getDraftManufacturers(): Manufacturer[] {
  return draftManufacturers(manufacturers);
}

export function getManufacturersInCategory(slug: string): Manufacturer[] {
  return manufacturers.filter(
    (profile) => isPublishedManufacturer(profile) && profile.categories.includes(slug),
  );
}

export function getFeaturedManufacturers(): Manufacturer[] {
  return manufacturers.filter((profile) => profile.featured && isPublishedManufacturer(profile));
}

/** Any manufacturer file, including a draft. Admin preview uses this. Public pages do not. */
export function getManufacturerRecord(slug: string): Manufacturer | undefined {
  return manufacturers.find((profile) => profile.slug === slug);
}

export function getManufacturer(slug: string): Manufacturer | undefined {
  const profile = getManufacturerRecord(slug);
  return profile && isPublishedManufacturer(profile) ? profile : undefined;
}

export function sourceNumber(profile: Manufacturer, id: string): number {
  const index = profile.sources.findIndex((source) => source.id === id);
  if (index < 0) {
    throw new Error(`Profile ${profile.slug} has no source ${id}.`);
  }
  return index + 1;
}

export function inputOriginLabel(origin: InputOrigin): string {
  switch (origin) {
    case 'us':
      return 'United States';
    case 'foreign':
      return 'Foreign';
    case 'mixed':
      return 'Mixed';
    case 'unknown':
      return 'Unknown';
  }
}

export function sourceKindLabel(kind: Manufacturer['sources'][number]['kind']): string {
  switch (kind) {
    case 'company':
      return 'Company';
    case 'news':
      return 'News';
    case 'government':
      return 'Government';
    case 'reference':
      return 'Reference';
  }
}

export function placeLine(profile: Manufacturer): string {
  return `${profile.location.city}, ${profile.location.region}`;
}

export interface OutboundTarget {
  href: string;
  label: string;
  affiliate: boolean;
  disclosure?: string;
  network?: string;
}

/** Primary company link: the affiliate URL when one is on the record, otherwise the official site. */
export function outboundTarget(profile: Manufacturer): OutboundTarget {
  if (profile.affiliate) {
    return {
      href: profile.affiliate.url,
      label: profile.websiteLabel,
      affiliate: true,
      disclosure: profile.affiliate.disclosure,
      network: profile.affiliate.network,
    };
  }
  return {
    href: profile.website,
    label: profile.websiteLabel,
    affiliate: false,
  };
}

export function logoFileIssues(
  profile: { slug: string; logo: { src: string; width: number; height: number } },
  root = publicRoot,
): string[] {
  return imageFileIssues(profile.slug, profile.logo, 'logo', root);
}

export function imageFileIssues(
  slug: string,
  image: { src: string; width: number; height: number },
  field: string,
  root = publicRoot,
): string[] {
  const issues: string[] = [];
  const src = image.src;
  const prefix = `/manufacturers/${slug}/`;
  if (
    !src.startsWith(prefix) ||
    src.includes('\\') ||
    src.includes('..') ||
    src.includes('//') ||
    /[?#]/.test(src)
  ) {
    issues.push(
      `${field}.src must be a file under public/manufacturers/${slug}/. Found "${src}".`,
    );
    return issues;
  }

  const ext = nodePath.posix.extname(src).toLowerCase();
  if (!logoExtensions.has(ext)) {
    issues.push(`${field}.src must be a png, jpg, jpeg, webp, gif, or svg file. Found "${src}".`);
    return issues;
  }

  const filePath = nodePath.resolve(root, src.slice(1));
  const slugDir = nodePath.resolve(root, 'manufacturers', slug);
  if (filePath !== slugDir && !filePath.startsWith(`${slugDir}${nodePath.sep}`)) {
    issues.push(`${field}.src must stay inside public/manufacturers/${slug}/. Found "${src}".`);
    return issues;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    issues.push(`${field} file is missing on disk: public${src}`);
    return issues;
  }

  if (ext === '.svg') return issues;

  let size: { width: number; height: number };
  try {
    size = readRasterSize(filePath, ext);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Could not read the image.';
    issues.push(`${field} file could not be read (${detail}): public${src}`);
    return issues;
  }

  if (size.width !== image.width || size.height !== image.height) {
    issues.push(
      `${field} width and height must match the file. public${src} is ${size.width} by ${size.height}. The record says ${image.width} by ${image.height}.`,
    );
  }

  return issues;
}

function readRasterSize(filePath: string, ext: string): { width: number; height: number } {
  const buf = readFileSync(filePath);
  if (ext === '.png') return readPngSize(buf);
  if (ext === '.gif') return readGifSize(buf);
  if (ext === '.jpg' || ext === '.jpeg') return readJpegSize(buf);
  if (ext === '.webp') return readWebpSize(buf);
  throw new Error(`unsupported type ${ext}`);
}

function readPngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readGifSize(buf: Buffer): { width: number; height: number } {
  const sig = buf.toString('ascii', 0, 6);
  if (buf.length < 10 || (sig !== 'GIF87a' && sig !== 'GIF89a')) {
    throw new Error('not a GIF');
  }
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function readJpegSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('not a JPEG');
  }
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) throw new Error('bad JPEG segment');
    offset += 2 + length;
  }
  throw new Error('JPEG size was not found');
}

function readWebpSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP');
  }
  const format = buf.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  if (format === 'VP8 ') {
    const start = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (start < 0 || start + 7 >= buf.length) throw new Error('WebP VP8 size was not found');
    return {
      width: buf.readUInt16LE(start + 3) & 0x3fff,
      height: buf.readUInt16LE(start + 5) & 0x3fff,
    };
  }
  if (format === 'VP8L') {
    if (buf[20] !== 0x2f) throw new Error('bad WebP lossless signature');
    const b1 = buf[21];
    const b2 = buf[22];
    const b3 = buf[23];
    const b4 = buf[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  throw new Error(`unsupported WebP chunk ${format}`);
}
