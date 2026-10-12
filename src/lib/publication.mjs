/**
 * Who is on the public list.
 * A missing status is published, the same default as the manufacturer schema.
 * Anything other than that, including `draft`, stays off public pages.
 * @param {{ status?: unknown } | null | undefined} profile
 */
export function isPublishedManufacturer(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const status = profile.status;
  return status === undefined || status === 'published';
}

/**
 * @param {unknown} profiles
 */
export function publishedManufacturers(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter(isPublishedManufacturer);
}

/**
 * @param {unknown} profiles
 */
export function draftManufacturers(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter((profile) => profile && typeof profile === 'object' && profile.status === 'draft');
}
