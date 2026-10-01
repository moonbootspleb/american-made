import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** HttpOnly session cookie. The value is a signed expiry, never the password. */
export const COOKIE_NAME = 'af_admin';

/** 12 hours. Changing ADMIN_PASSWORD also invalidates every existing cookie. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

const PLACEHOLDER_PASSWORDS = new Set([
  'changeme',
  'change-me',
  'change_me',
  'password',
  'admin',
  'secret',
  'your-password',
  'your_password',
  'example',
  'placeholder',
]);

/**
 * A usable admin password. Empty, short, and placeholder values are unset,
 * so login fails closed instead of accepting a sample from the docs.
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function configuredPassword(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value.length < 12) return undefined;
  if (PLACEHOLDER_PASSWORDS.has(value.toLowerCase())) return undefined;
  if (/^x{4,}$/i.test(value)) return undefined;
  return value;
}

/**
 * Fixed-length digests so a length mismatch cannot throw or cut the compare short.
 * @param {string} input
 * @param {string} expected
 */
export function passwordsMatch(input, expected) {
  const left = createHash('sha256').update(String(input), 'utf8').digest();
  const right = createHash('sha256').update(String(expected), 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * @param {string} secret
 * @param {number} issuedAtMs
 */
export function signSession(secret, issuedAtMs) {
  const exp = issuedAtMs + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * @param {unknown} token
 * @param {unknown} secret
 * @param {number} nowMs
 */
export function sessionIsValid(token, secret, nowMs) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length === 0) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const given = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data?.exp === 'number' && Number.isFinite(data.exp) && data.exp > nowMs;
  } catch {
    return false;
  }
}

const ALLOWED_FORMS = new Set(['all', 'review-request', 'company-suggestion', 'page-submission']);

/**
 * Only send people back to the queue. Anything else becomes the queue itself.
 * @param {unknown} raw
 */
export function safeNextPath(raw) {
  const fallback = '/admin/queue';
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value || value.length > 180) return fallback;
  if (!value.startsWith('/admin') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || value.includes('://')) return fallback;

  let url;
  try {
    url = new URL(value, 'https://queue.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://queue.invalid') return fallback;
  if (url.username || url.password || url.hash) return fallback;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/admin' && path !== '/admin/queue') return fallback;
  if (url.searchParams.getAll('form').length > 1) return fallback;

  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== 'form')) return fallback;

  const form = url.searchParams.get('form');
  if (form !== null && !ALLOWED_FORMS.has(form)) return fallback;
  if (!form || form === 'all') return fallback;
  return `/admin/queue?form=${encodeURIComponent(form)}`;
}
