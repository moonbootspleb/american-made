import { z } from 'zod';

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

const cited = z.object({
  text: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});

export const manufacturerSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  legalName: z.string().min(1),
  featured: z.boolean(),
  category: z.string().min(1),
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
  website: z.string().url(),
  websiteLabel: z.string().min(1),
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
export type CitedBlock = z.infer<typeof cited>;

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

    for (const id of sourceIds) {
      if (!citedIds.has(id)) {
        throw new Error(`${path} lists source "${id}" but never cites it.`);
      }
    }

    return profile;
  });

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

const manufacturers = loadManufacturers();

export function getAllManufacturers(): Manufacturer[] {
  return manufacturers;
}

export function getFeaturedManufacturers(): Manufacturer[] {
  return manufacturers.filter((profile) => profile.featured);
}

export function getManufacturer(slug: string): Manufacturer | undefined {
  return manufacturers.find((profile) => profile.slug === slug);
}

export function sourceNumber(profile: Manufacturer, id: string): number {
  const index = profile.sources.findIndex((source) => source.id === id);
  if (index < 0) {
    throw new Error(`Profile ${profile.slug} has no source ${id}.`);
  }
  return index + 1;
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
