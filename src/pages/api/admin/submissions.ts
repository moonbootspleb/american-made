import type { APIRoute } from 'astro';
import { loadQueue, sessionFromCookies } from '../../../lib/admin-server';
import { countByForm, filterByForm, selectedForm } from '../../../lib/queue-view.mjs';

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  if (!sessionFromCookies(cookies)) return json({ error: 'unauthorized' }, 401);

  const loaded = await loadQueue();
  if (!loaded.ok) {
    const status = loaded.reason === 'upstream' ? 502 : 503;
    return json({ error: loaded.reason }, status);
  }

  const form = selectedForm(url.searchParams.get('form'));
  return json(
    {
      form,
      siteId: loaded.siteId,
      truncated: loaded.truncated,
      counts: countByForm(loaded.submissions),
      submissions: filterByForm(loaded.submissions, form),
    },
    200,
  );
};
