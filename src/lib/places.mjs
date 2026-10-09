import { z } from 'zod';

/**
 * A place that can go on a map.
 *
 * `country` is an ISO 3166-1 alpha-2 code (US, ES, ZA) or `unknown`.
 * `status: "sourced"` needs at least one source id that states this place.
 * Anything not stated by a source is `status: "unverified"`.
 * `lat` and `lng` are optional. They go in only together, and only when
 * `coordinateSources` names a source that confirms them. Never geocode a guess.
 */
export const countryCode = z.union([z.string().regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 code such as US.'), z.literal('unknown')]);

export const placeSchema = z
  .object({
    label: z.string().min(1).max(160).optional(),
    city: z.string().min(1).max(80).optional(),
    region: z.string().min(1).max(80).optional(),
    country: countryCode,
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    coordinateSources: z.array(z.string().min(1)).min(1).optional(),
    status: z.enum(['sourced', 'unverified']),
    sources: z.array(z.string().min(1)).default([]),
    note: z.string().min(1).max(400).optional(),
  })
  .strict();

/**
 * Rules a schema cannot express alone. Returns plain messages.
 * @param {z.infer<typeof placeSchema>} place
 */
export function placeIssues(place) {
  const issues = [];
  if (place.status === 'sourced' && place.sources.length === 0) {
    issues.push('A sourced place needs at least one source id. Mark it unverified otherwise.');
  }
  if (place.status === 'sourced' && place.country === 'unknown') {
    issues.push('A sourced place cannot have country "unknown".');
  }
  const hasLat = place.lat !== undefined;
  const hasLng = place.lng !== undefined;
  if (hasLat !== hasLng) issues.push('lat and lng go in together.');
  if (hasLat && !place.coordinateSources) {
    issues.push('lat and lng need coordinateSources naming a source that confirms them.');
  }
  if (!hasLat && place.coordinateSources) {
    issues.push('coordinateSources is set but there are no coordinates.');
  }
  return issues;
}

/** Every source id a place cites. */
export function placeSourceIds(place) {
  return [...place.sources, ...(place.coordinateSources ?? [])];
}

/**
 * A manufacturer facility: plant, office, warehouse, mill, mine.
 */
export const facilitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(160),
    kind: z.enum(['headquarters', 'manufacturing', 'office', 'warehouse', 'mill', 'mine', 'farm', 'forest', 'other']),
    place: placeSchema,
  })
  .strict();
