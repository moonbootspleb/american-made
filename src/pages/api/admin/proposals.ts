import type { APIRoute } from 'astro';
import { sessionFromCookies } from '../../../lib/admin-server';
import { applyProposalAction, researchWritesAllowed } from '../../../lib/proposal-actions.mjs';
import { bundledProposals } from '../../../lib/proposal-bundle';
import { buildReviewRecord } from '../../../lib/review-audit.mjs';
import { saveAuditToBlobs } from '../../../lib/review-audit-store';
import { liveQuoteCheck } from '../../../lib/source-view.mjs';
import { loadProposalsForAdmin } from '../../../lib/supply-proposals.mjs';

export const prerender = false;

const PROPOSAL_ID = /^[a-z0-9]+(?:--?[a-z0-9]+)*$/;
const ACTIONS = new Set(['verify', 'needs-source', 'reject']);

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

  const fields: Record<string, string> = { id: '', action: '', reviewer: '', note: '', viewerQuoteFound: '' };
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === 'object') {
      for (const key of Object.keys(fields)) {
        const value = (body as Record<string, unknown>)[key];
        if (typeof value === 'string' || typeof value === 'boolean') fields[key] = String(value);
      }
    }
  } else {
    const form = await request.formData();
    for (const key of Object.keys(fields)) fields[key] = String(form.get(key) || '');
  }
  const { id, action } = fields;

  const finish = (result: { status: number; reason: string } & Record<string, unknown>) => {
    if (type.includes('application/json')) return json(result, result.status);
    return redirect(`/admin/queue?result=${encodeURIComponent(result.reason)}#proposal-${encodeURIComponent(id)}`, 303);
  };

  if (!PROPOSAL_ID.test(id)) return finish({ ok: false, status: 400, reason: 'bad-id' });
  if (!ACTIONS.has(action)) return finish({ ok: false, status: 400, reason: 'bad-action' });

  const { proposals } = loadProposalsForAdmin(process.cwd(), bundledProposals());
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal) return finish({ ok: false, status: 404, reason: 'not-found' });
  if (proposal.status === 'filed' || proposal.status === 'rejected') {
    return finish({ ok: false, status: 409, reason: 'already-closed' });
  }

  // Fetch the live page now, so the record holds what the page said at decision time.
  const check = await liveQuoteCheck(proposal.sourceUrl, proposal.quote);
  const review = buildReviewRecord({
    proposal,
    decision: action,
    reviewer: fields.reviewer,
    note: fields.note,
    viewerQuoteFound: fields.viewerQuoteFound || null,
    check: check.ok ? { ok: true, sha256: check.sha256, found: check.found } : { ok: false, error: check.error },
  });

  if (!researchWritesAllowed()) {
    const saved = await saveAuditToBlobs(review);
    return finish({ ok: saved, status: saved ? 202 : 500, reason: saved ? 'host-readonly-recorded' : 'audit-failed', review });
  }

  const result = applyProposalAction({ root: process.cwd(), id, action, writesAllowed: true, review });
  return finish({ ...result, review });
};
