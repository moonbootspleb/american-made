import type { APIRoute } from 'astro';
import { sessionFromCookies } from '../../../lib/admin-server';
import { bundledProposals } from '../../../lib/proposal-bundle';
import { buildFramedPage, failurePage, fetchLiveSource, frameHeaders, makeNonce, sourceUrlFor } from '../../../lib/source-view.mjs';
import { loadProposalsForAdmin } from '../../../lib/supply-proposals.mjs';

export const prerender = false;

/**
 * Live source viewer for one supply proposal: /api/admin/source-view?proposal=<id>
 * Admin only (the middleware also returns 401). Fetches only the URL on that proposal, so it is not an open proxy.
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!sessionFromCookies(cookies)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  }
  const nonce = makeNonce();
  const headers = frameHeaders(nonce);
  const id = url.searchParams.get('proposal') || '';
  const { proposals } = loadProposalsForAdmin(process.cwd(), bundledProposals());
  const proposal = proposals.find((item) => item.id === id);
  const target = sourceUrlFor(proposals, id);
  if (!proposal || !target) {
    return new Response(failurePage({ message: 'No proposal with that id is on file, so no page was fetched.', proposalId: id, nonce }), {
      status: 404,
      headers,
    });
  }
  const live = await fetchLiveSource(target);
  if (!live.ok) {
    return new Response(failurePage({ message: live.error, url: target, proposalId: id, nonce }), { status: 502, headers });
  }
  const page = buildFramedPage(live.html, { url: live.finalUrl, quote: proposal.quote, proposalId: proposal.id, nonce });
  return new Response(page, { status: 200, headers });
};
