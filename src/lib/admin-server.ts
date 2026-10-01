import { getSecret } from 'astro:env/server';
import {
  configuredToken,
  resolveSiteId,
  submissionsUrl,
} from './admin-config.mjs';
import {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  configuredPassword,
  passwordsMatch,
  sessionIsValid,
  signSession,
} from './admin-session.mjs';
import { normalizeSubmissions } from './queue-view.mjs';

/**
 * Server-only, same rule as STRIPE_SECRET_KEY in netlify/functions/donate.ts.
 * getSecret reads process.env at request time on Netlify. Nothing here is PUBLIC_.
 */
function readEnv(name: string): string | undefined {
  const fromAstro = getSecret(name);
  const value = typeof fromAstro === 'string' && fromAstro.trim() ? fromAstro : process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function adminPassword(): string | undefined {
  return configuredPassword(readEnv('ADMIN_PASSWORD'));
}

export function netlifyToken(): string | undefined {
  return configuredToken(readEnv('NETLIFY_AUTH_TOKEN'));
}

export function netlifySite() {
  return resolveSiteId({
    NETLIFY_SITE_ID: readEnv('NETLIFY_SITE_ID'),
    SITE_ID: readEnv('SITE_ID'),
  });
}

type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      path?: string;
      maxAge?: number;
    },
  ): void;
  delete(
    name: string,
    options?: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      path?: string;
    },
  ): void;
};

export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    const proto = forwarded.split(',')[0]?.trim().toLowerCase();
    if (proto === 'https') return true;
    if (proto === 'http') return false;
  }
  return new URL(request.url).protocol === 'https:';
}

function cookieOptions(request: Request, maxAge?: number) {
  return {
    httpOnly: true,
    secure: requestIsSecure(request),
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export function sessionFromCookies(cookies: CookieJar, now = Date.now()): boolean {
  const secret = adminPassword();
  if (!secret) return false;
  return sessionIsValid(cookies.get(COOKIE_NAME)?.value, secret, now);
}

export function establishSession(cookies: CookieJar, request: Request, now = Date.now()): void {
  const secret = adminPassword();
  if (!secret) return;
  cookies.set(COOKIE_NAME, signSession(secret, now), cookieOptions(request, SESSION_TTL_SECONDS));
}

export function clearSession(cookies: CookieJar, request: Request): void {
  cookies.delete(COOKIE_NAME, cookieOptions(request));
}

export { passwordsMatch };

export class QueueReadError extends Error {
  status: number;

  constructor(status: number) {
    super('Netlify submissions request failed');
    this.name = 'QueueReadError';
    this.status = status;
  }
}

const MAX_ITEMS = 500;
const MAX_PAGES = 25;

async function fetchSubmissionPages(token: string, siteId: string): Promise<{ raw: unknown[]; truncated: boolean }> {
  const raw: unknown[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = submissionsUrl(siteId, page);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        redirect: 'manual',
      });
    } catch {
      throw new QueueReadError(0);
    }

    if (response.status >= 300 && response.status < 400) throw new QueueReadError(response.status);
    if (!response.ok) throw new QueueReadError(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new QueueReadError(response.status);
    }
    if (!Array.isArray(body)) throw new QueueReadError(response.status);
    if (body.length === 0) break;

    raw.push(...body);
    if (raw.length >= MAX_ITEMS) {
      truncated = true;
      break;
    }
    if (body.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { raw: raw.slice(0, MAX_ITEMS), truncated };
}

export type QueueLoad =
  | {
      ok: true;
      submissions: ReturnType<typeof normalizeSubmissions>;
      truncated: boolean;
      siteId: string;
      siteSource: 'NETLIFY_SITE_ID' | 'SITE_ID' | 'fallback';
    }
  | { ok: false; reason: 'not_configured' | 'invalid_site' | 'upstream'; status?: number };

/**
 * Read the Netlify Forms inbox on the server. The token never leaves this function.
 */
export async function loadQueue(): Promise<QueueLoad> {
  const site = netlifySite();
  if ('error' in site) return { ok: false, reason: 'invalid_site' };

  const token = netlifyToken();
  if (!token) return { ok: false, reason: 'not_configured' };

  try {
    const { raw, truncated } = await fetchSubmissionPages(token, site.id);
    return {
      ok: true,
      submissions: normalizeSubmissions(raw),
      truncated,
      siteId: site.id,
      siteSource: site.source,
    };
  } catch (error) {
    const status = error instanceof QueueReadError ? error.status : 0;
    return { ok: false, reason: 'upstream', status };
  }
}
