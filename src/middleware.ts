import { defineMiddleware } from 'astro:middleware';
import { safeNextPath } from './lib/admin-session.mjs';
import { sessionFromCookies } from './lib/admin-server';

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '');
  return pathname;
}

function classify(path: string): 'page' | 'api' | null {
  if (path === '/api/admin' || path.startsWith('/api/admin/')) return 'api';
  if (path === '/admin' || path.startsWith('/admin/')) return 'page';
  return null;
}

function privateHeaders(response: Response): Response {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') headers.set(key, value);
  });
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length === 0) {
    const single = response.headers.get('set-cookie');
    if (single) headers.append('Set-Cookie', single);
  } else {
    for (const cookie of setCookies) headers.append('Set-Cookie', cookie);
  }
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = normalizePath(context.url.pathname);
  const kind = classify(path);
  if (!kind) return next();

  if (kind === 'page' && (path === '/admin/login' || path === '/admin/logout')) {
    const response = await next();
    return privateHeaders(response);
  }

  if (!sessionFromCookies(context.cookies)) {
    if (kind === 'api') {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'private, no-store',
          'x-robots-tag': 'noindex',
        },
      });
    }

    const params = new URLSearchParams();
    params.set('next', safeNextPath(`${path}${context.url.search}`));
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/admin/login?${params.toString()}`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  return privateHeaders(await next());
});
