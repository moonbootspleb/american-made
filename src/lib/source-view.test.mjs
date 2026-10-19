import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildFramedPage, failurePage, fetchLiveSource, frameHeaders, liveQuoteCheck, sourceUrlFor, stripActiveContent, viewerScript } from './source-view.mjs';

const fixture = readFileSync(new URL('../data/research-fixtures/source-view/flatware-page.html', import.meta.url), 'utf8');

test('sourceUrlFor only returns a URL that belongs to a proposal on file', () => {
  const proposals = [{ id: 'a--b--c', sourceUrl: 'https://example.com/page' }];
  assert.equal(sourceUrlFor(proposals, 'a--b--c'), 'https://example.com/page');
  assert.equal(sourceUrlFor(proposals, 'https://evil.example/'), null);
  assert.equal(sourceUrlFor(proposals, ''), null);
  assert.equal(sourceUrlFor([{ id: 'x', sourceUrl: 'file:///etc/passwd' }], 'x'), null);
});

test('stripActiveContent removes scripts, handlers, frames, refresh, CSP meta, base, and javascript: links', () => {
  const out = stripActiveContent(fixture);
  assert.equal(/<script/i.test(out), false);
  assert.equal(/onload=/i.test(out), false);
  assert.equal(/<iframe/i.test(out), false);
  assert.equal(/http-equiv="refresh"/i.test(out), false);
  assert.equal(/Content-Security-Policy/i.test(out), false);
  assert.equal(/<base/i.test(out), false);
  assert.equal(/javascript:/i.test(out), false);
  assert.ok(out.includes('Fixture Steel'));
});

test('buildFramedPage injects our base, style, and one nonce script before </body>', () => {
  const page = buildFramedPage(fixture, { url: 'https://source.example/post/', quote: 'reliable supplier', proposalId: 'a--b--c', nonce: 'abc123' });
  assert.ok(page.includes('<base href="https://source.example/post/" target="_blank">'));
  assert.equal((page.match(/<script/g) || []).length, 1);
  assert.ok(page.includes('<script nonce="abc123">'));
  assert.ok(page.indexOf('<script nonce="abc123">') > page.indexOf('Second section'));
  assert.ok(page.includes('taf-source-view'));
});

test('viewerScript embeds the quote safely and carries the normalizer', () => {
  const script = viewerScript('</script><script>alert(1)</script>', 'a--b');
  assert.equal(script.includes('</script>'), false);
  assert.ok(script.includes('normalizeWithMap'));
  assert.doesNotThrow(() => new Function(script));
});

test('frameHeaders lock scripts to the nonce and framing to this site', () => {
  const headers = frameHeaders('n0nce');
  assert.match(headers['content-security-policy'], /script-src 'nonce-n0nce'/);
  assert.match(headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.match(headers['content-security-policy'], /form-action 'none'/);
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
});

test('failurePage says plainly that the live page did not load', () => {
  const page = failurePage({ message: 'The source site answered HTTP 503.', url: 'https://example.com/', proposalId: 'a--b', nonce: 'n' });
  assert.ok(page.includes('The live source page did not load.'));
  assert.ok(page.includes('HTTP 503'));
  assert.ok(page.includes('failed:true'));
});

test('fetchLiveSource and liveQuoteCheck report HTTP errors and non-HTML without inventing a match', async () => {
  const fake = (status, type, body) => async () =>
    new Response(body, { status, headers: { 'content-type': type } });
  const down = await fetchLiveSource('https://example.com/', fake(503, 'text/html', 'x'));
  assert.deepEqual([down.ok, down.status], [false, 503]);
  const pdf = await fetchLiveSource('https://example.com/', fake(200, 'application/pdf', 'x'));
  assert.equal(pdf.ok, false);
  const thrown = await fetchLiveSource('https://example.com/', async () => {
    throw new Error('offline');
  });
  assert.equal(thrown.ok, false);
  const hit = await liveQuoteCheck('https://example.com/', 'Fixture Steel for being a reliable supplier', fake(200, 'text/html', fixture));
  assert.equal(hit.ok, true);
  assert.equal(hit.found, true);
  const miss = await liveQuoteCheck('https://example.com/', 'not on this page at all', fake(200, 'text/html', fixture));
  assert.equal(miss.found, false);
});
