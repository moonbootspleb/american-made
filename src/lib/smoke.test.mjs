import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  chromeCandidates,
  fillsViewport,
  findChrome,
  formatReport,
  graphFromHtml,
  isCircleMarkerPath,
  isLoginRedirect,
  leakedNeedles,
  loadManufacturers,
  parseBaseUrl,
  pinCount,
} from './smoke.mjs';

test('parseBaseUrl accepts http and https and drops a trailing slash', () => {
  assert.deepEqual(parseBaseUrl(['node', 'smoke', '--base-url', 'https://example.com/']), {
    baseUrl: 'https://example.com',
  });
  assert.deepEqual(parseBaseUrl(['node', 'smoke', '--base-url=http://localhost:4321/preview']), {
    baseUrl: 'http://localhost:4321/preview',
  });
  assert.deepEqual(parseBaseUrl(['node', 'smoke', '--help']), { help: true });
});

test('parseBaseUrl rejects a missing, unknown, or non-http URL', () => {
  assert.throws(() => parseBaseUrl(['node', 'smoke']), /--base-url/);
  assert.throws(() => parseBaseUrl(['node', 'smoke', '--base-url', 'ftp://example.com']), /http/);
  assert.throws(() => parseBaseUrl(['node', 'smoke', '--nope']), /Unknown argument/);
});

test('loadManufacturers splits published files from drafts', () => {
  const directory = mkdtempSync(nodePath.join(tmpdir(), 'smoke-manufacturers-'));
  try {
    writeFileSync(
      nodePath.join(directory, 'open.json'),
      JSON.stringify({ slug: 'open-mill', name: 'Open Mill' }),
    );
    writeFileSync(
      nodePath.join(directory, 'draft.json'),
      JSON.stringify({
        slug: 'closed-shop',
        name: 'Closed Shop',
        legalName: 'Closed Shop LLC',
        status: 'draft',
      }),
    );
    writeFileSync(
      nodePath.join(directory, 'held.json'),
      JSON.stringify({ slug: 'held-back', name: 'Held Back', status: 'hidden' }),
    );
    const { published, unpublished } = loadManufacturers(directory);
    assert.deepEqual(published.map((profile) => profile.slug), ['open-mill']);
    assert.deepEqual(
      unpublished.map((profile) => profile.slug).sort(),
      ['closed-shop', 'held-back'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the manufacturer directory on disk loads', () => {
  const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../data/manufacturers');
  const { published, unpublished } = loadManufacturers(root);
  const files = readdirSync(root).filter((name) => name.endsWith('.json'));
  assert.equal(published.length + unpublished.length, files.length);
  assert.ok(published.length > 0);
});

test('draft needles are found in HTML and in the graph, and missed when absent', () => {
  const draft = { slug: 'closed-shop', name: 'Closed Shop', legalName: 'Closed & Co' };
  const clean = '<html><title>The American Forge</title><h2>Open Mill</h2></html>';
  assert.deepEqual(leakedNeedles(clean, { nodes: [], edges: [] }, draft), []);
  const leakedHtml = '<p>Closed Shop</p>';
  assert.ok(leakedNeedles(leakedHtml, null, draft).includes('Closed Shop'));
  const escaped = '<p>Closed &amp; Co</p>';
  assert.ok(leakedNeedles(escaped, null, draft).includes('Closed & Co'));
  const graph = { nodes: [{ slug: 'closed-shop', name: 'Other' }], edges: [] };
  assert.ok(leakedNeedles(clean, graph, draft).includes('closed-shop'));
});

test('graph JSON is read from the page and pins follow sourced locations', () => {
  const html = `<script id="supply-graph-data" type="application/json">{"nodes":[{"locations":[{},{}]},{"locations":[]}],"edges":[{}]}</script>`;
  const graph = graphFromHtml(html);
  assert.equal(pinCount(graph), 2);
  assert.equal(graphFromHtml('<html></html>'), null);
  assert.equal(graphFromHtml('<script id="supply-graph-data">not json</script>'), null);
  assert.equal(isCircleMarkerPath('M0,0A10,10,0,1,1,0,0'), true);
  assert.equal(isCircleMarkerPath('M10 20L30 40'), false);
});

test('admin redirects are only the login page', () => {
  assert.equal(isLoginRedirect(302, '/admin/login?next=%2Fadmin%2Fqueue'), true);
  assert.equal(isLoginRedirect(302, 'https://example.com/admin/login'), true);
  assert.equal(isLoginRedirect(401, '/admin/login'), false);
  assert.equal(isLoginRedirect(302, '/admin/login-help'), false);
  assert.equal(isLoginRedirect(200, '/admin/queue'), false);
});

test('the report names each failure and exits on a failed count', () => {
  const report = formatReport([
    { name: 'Home', pass: true, detail: '200' },
    { name: 'Company profile', pass: false, detail: 'missing name' },
  ]);
  assert.match(report, /Home\s+PASS\s+200/);
  assert.match(report, /Company profile\s+FAIL\s+missing name/);
  assert.match(report, /1\/2 passed/);
});

test('a near-fullscreen map covers most of the viewport', () => {
  assert.equal(fillsViewport({ width: 1280, height: 820 }, { width: 1280, height: 900 }), true);
  assert.equal(fillsViewport({ width: 700, height: 400 }, { width: 1280, height: 900 }), false);
  assert.equal(fillsViewport({ width: 0, height: 0 }, { width: 1280, height: 900 }), false);
});

test('Chrome is the first candidate that exists', () => {
  assert.equal(
    findChrome(['/missing', '/usr/bin/google-chrome'], (path) => path.endsWith('google-chrome')),
    '/usr/bin/google-chrome',
  );
  assert.equal(findChrome(['/missing'], () => false), null);
  const candidates = chromeCandidates({ CHROME_PATH: '/opt/chrome' });
  assert.equal(candidates[0], '/opt/chrome');
  assert.ok(readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8').includes('SITE_NAME'));
});
