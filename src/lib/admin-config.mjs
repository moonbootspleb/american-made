/**
 * Production site for american-forge (https://american-forge.netlify.app).
 * Used only when NETLIFY_SITE_ID and Netlify's own SITE_ID are both unset.
 */
export const PROD_SITE_ID = '13e8b163-dcb1-4638-8c3f-df186953f5a1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} raw
 */
export function isSiteId(raw) {
  return typeof raw === 'string' && UUID.test(raw.trim());
}

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function configuredToken(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value.length < 20) return undefined;
  if (/placeholder|changeme|your[_-]?token|example|^x{4,}$/i.test(value)) return undefined;
  return value;
}

/**
 * Prefer NETLIFY_SITE_ID, then the SITE_ID Netlify injects into the running site,
 * then the documented production id.
 * A present but invalid NETLIFY_SITE_ID fails closed and does not fall through.
 *
 * @param {{ NETLIFY_SITE_ID?: unknown, SITE_ID?: unknown }} env
 * @returns {{ id: string, source: 'NETLIFY_SITE_ID' | 'SITE_ID' | 'fallback' } | { error: 'invalid' }}
 */
export function resolveSiteId(env) {
  const explicit = typeof env.NETLIFY_SITE_ID === 'string' ? env.NETLIFY_SITE_ID.trim() : '';
  if (explicit) {
    if (!isSiteId(explicit)) return { error: 'invalid' };
    return { id: explicit, source: 'NETLIFY_SITE_ID' };
  }
  const injected = typeof env.SITE_ID === 'string' ? env.SITE_ID.trim() : '';
  if (injected && isSiteId(injected)) return { id: injected, source: 'SITE_ID' };
  return { id: PROD_SITE_ID, source: 'fallback' };
}

/**
 * The token is a header, never part of this URL.
 * @param {string} siteId
 * @param {number} page
 */
export function submissionsUrl(siteId, page) {
  const url = new URL(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/submissions`,
  );
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', String(page));
  return url;
}
