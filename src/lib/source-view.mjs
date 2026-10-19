import { randomBytes } from 'node:crypto';
import { checkQuoteInHtml, normalizeWithMap } from './quote-match.mjs';

/**
 * The live source viewer behind /api/admin/source-view.
 * The admin page frames our own response, not the source site, so the quote can be highlighted.
 * Safety:
 * - only URLs that belong to a proposal on file are fetched (no open proxy);
 * - every script, inline handler, frame, and meta refresh or CSP from the source is removed;
 * - our response carries its own CSP: only the nonce'd viewer script runs, forms go nowhere,
 *   and only this site can frame it;
 * - the admin page frames it with sandbox (no same-origin), so even a missed script could not read admin cookies.
 */

export const FETCH_TIMEOUT_MS = 12000;
export const MAX_SOURCE_BYTES = 3 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TheAmericanForgeReview/1.0';

export function makeNonce() {
  return randomBytes(16).toString('base64');
}

/**
 * @param {string} nonce
 */
export function frameHeaders(nonce) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src * data: blob:",
      `script-src 'nonce-${nonce}'`,
      "style-src * data: blob: 'unsafe-inline'",
      "form-action 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "frame-ancestors 'self'",
    ].join('; '),
  };
}

/**
 * The proposal's source URL, or null. Callers fetch only this URL.
 * @param {Array<{ id: string, sourceUrl: string }>} proposals
 * @param {string | null} id
 */
export function sourceUrlFor(proposals, id) {
  if (!id) return null;
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal) return null;
  try {
    const url = new URL(proposal.sourceUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 */
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * JSON safe to put inside a <script> element.
 * @param {unknown} value
 */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, ' ');
}

/**
 * Remove anything from the source page that could run code, reload, or set its own policy.
 * @param {string} html
 */
export function stripActiveContent(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<(iframe|frame|frameset|object|embed|applet|portal)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|frame|object|embed|applet|portal|base)\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*(refresh|content-security-policy|x-frame-options|set-cookie)[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*["']?(?:preload|modulepreload|prefetch|import)["']?[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"');
}

/**
 * The script that runs inside the framed page: find the quote across text nodes, wrap it in <mark>,
 * scroll to it, and tell the admin page whether it was found.
 * @param {string} quote
 * @param {string} proposalId
 */
export function viewerScript(quote, proposalId) {
  return `(function () {
  var normalizeWithMap = ${normalizeWithMap.toString()};
  var QUOTE = ${scriptJson(quote)};
  var ID = ${scriptJson(proposalId)};
  function post(found, method) {
    try { parent.postMessage({ type: 'taf-source-view', proposal: ID, found: found, method: method }, '*'); } catch (e) {}
  }
  function run() {
    if (!document.body) { post(false, 'none'); return; }
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parentEl = node.parentElement;
        if (parentEl && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(parentEl.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var full = '';
    var node;
    var lastBlock = null;
    function blockOf(textNode) {
      var el = textNode.parentElement;
      while (el && el !== document.body) {
        var display = window.getComputedStyle(el).display || '';
        if (display.indexOf('inline') !== 0 && display !== 'contents') return el;
        el = el.parentElement;
      }
      return document.body;
    }
    while ((node = walker.nextNode())) {
      var block = blockOf(node);
      if (lastBlock && block !== lastBlock) full += ' ';
      lastBlock = block;
      nodes.push({ node: node, start: full.length });
      full += node.nodeValue;
    }
    var hay = normalizeWithMap(full);
    var needle = normalizeWithMap(QUOTE).text;
    var trimmed = needle.replace(/^["'\\s]+/, '').replace(/["'\\s]+$/, '');
    var method = 'normalized';
    var at = hay.text.indexOf(needle);
    var length = needle.length;
    if (at < 0 && trimmed) { at = hay.text.indexOf(trimmed); length = trimmed.length; method = 'trimmed'; }
    if (at < 0 || !length) { post(false, 'none'); document.documentElement.setAttribute('data-taf-quote', 'not-found'); return; }
    var start = hay.map[at];
    var end = hay.map[at + length - 1] + 1;
    if (full.slice(start, end) === QUOTE) method = 'exact';
    var first = null;
    for (var i = nodes.length - 1; i >= 0; i -= 1) {
      var item = nodes[i];
      var len = item.node.nodeValue.length;
      var s = Math.max(start, item.start) - item.start;
      var e = Math.min(end, item.start + len) - item.start;
      if (e <= s || s >= len) continue;
      if (!item.node.nodeValue.slice(s, e).trim()) continue;
      var range = document.createRange();
      range.setStart(item.node, s);
      range.setEnd(item.node, e);
      var mark = document.createElement('mark');
      mark.className = 'taf-quote';
      try { range.surroundContents(mark); first = mark; } catch (err) {}
    }
    if (first) {
      first.id = 'taf-quote';
      first.scrollIntoView({ block: 'center' });
      document.documentElement.setAttribute('data-taf-quote', 'found');
      post(true, method);
    } else {
      post(false, 'none');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();`;
}

const VIEWER_CSS = `mark.taf-quote{background:#ffe066!important;color:#111!important;outline:2px solid #e8590c;box-shadow:0 0 0 3px rgba(232,89,12,.25);padding:0 .1em;}
html{scroll-behavior:auto!important;}`;

/**
 * @param {string} html source page
 * @param {{ url: string, quote: string, proposalId: string, nonce: string }} options
 */
export function buildFramedPage(html, options) {
  const base = `<base href="${escapeAttr(options.url)}" target="_blank">`;
  const injected = `${base}<meta name="referrer" content="no-referrer"><style nonce="${options.nonce}">${VIEWER_CSS}</style>`;
  const script = `<script nonce="${options.nonce}">${viewerScript(options.quote, options.proposalId)}</script>`;
  let page = stripActiveContent(html);
  if (/<head\b[^>]*>/i.test(page)) page = page.replace(/<head\b[^>]*>/i, (tag) => `${tag}${injected}`);
  else page = `<head>${injected}</head>${page}`;
  if (/<\/body\s*>/i.test(page)) page = page.replace(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i, `${script}</body>`);
  else page = `${page}${script}`;
  return page;
}

/**
 * A plain page shown in the pane when the live source could not be loaded.
 * @param {{ message: string, url?: string, proposalId: string, nonce: string }} options
 */
export function failurePage(options) {
  const link = options.url
    ? `<p><a href="${escapeAttr(options.url)}" target="_blank" rel="noopener noreferrer">Open the source page in a new tab</a></p>`
    : '';
  const post = `<script nonce="${options.nonce}">try{parent.postMessage({type:'taf-source-view',proposal:${scriptJson(
    options.proposalId,
  )},found:false,method:'none',failed:true,message:${scriptJson(options.message)}},'*')}catch(e){}</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Live source not loaded</title><style nonce="${options.nonce}">body{font:16px/1.5 Georgia,serif;padding:2rem;color:#222;background:#f7f4ec}h1{font-size:1.2rem}</style></head><body><h1>The live source page did not load.</h1><p>${escapeAttr(
    options.message,
  )}</p>${link}<p>Nothing was checked against the page. Do not verify from the quote alone.</p>${post}</body></html>`;
}

/**
 * Fetch the live page as text. No cookies, no credentials, a size cap, and a timeout.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, html: string, finalUrl: string, status: number } | { ok: false, error: string, status?: number }>}
 */
export async function fetchLiveSource(url, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { ok: false, error: timedOut ? 'The source site did not answer within 12 seconds.' : 'The source site could not be reached.' };
  }
  const finalUrl = response.url || url;
  if (!/^https?:/i.test(finalUrl)) return { ok: false, error: 'The source redirected to a non-web address.' };
  if (!response.ok) return { ok: false, status: response.status, error: `The source site answered HTTP ${response.status}.` };
  const type = response.headers.get('content-type') || '';
  if (type && !/html|xml/i.test(type)) return { ok: false, status: response.status, error: `The source is ${type.split(';')[0]}, not a web page.` };
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_SOURCE_BYTES) return { ok: false, status: response.status, error: 'The source page is larger than 3 MB.' };
  return { ok: true, html: new TextDecoder('utf-8').decode(buffer), finalUrl, status: response.status };
}

/**
 * Fetch and check in one step, for the audit record and the research command.
 * @param {string} url
 * @param {string} quote
 * @param {typeof fetch} [fetchImpl]
 */
export async function liveQuoteCheck(url, quote, fetchImpl = fetch) {
  const live = await fetchLiveSource(url, fetchImpl);
  if (!live.ok) return { ok: false, error: live.error, status: live.status };
  return { ok: true, status: live.status, ...checkQuoteInHtml(live.html, quote) };
}
