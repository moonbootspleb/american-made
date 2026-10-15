import type { APIRoute } from 'astro';
import { sessionFromCookies } from '../../../lib/admin-server';
import { applyProposalAction, researchWritesAllowed } from '../../../lib/proposal-actions.mjs';

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

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!sessionFromCookies(cookies)) return json({ error: 'unauthorized' }, 401);

  let id = '';
  let action = '';
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === 'object') {
      if ('id' in body && typeof body.id === 'string') id = body.id;
      if ('action' in body && typeof body.action === 'string') action = body.action;
    }
  } else {
    const form = await request.formData();
    id = String(form.get('id') || '');
    action = String(form.get('action') || '');
  }

  const result = applyProposalAction({
    root: process.cwd(),
    id,
    action,
    writesAllowed: researchWritesAllowed(),
  });

  if (type.includes('application/json')) return json(result, result.status);
  return redirect(`/admin/queue?result=${encodeURIComponent(result.reason)}#supply-proposals`, 303);
};
