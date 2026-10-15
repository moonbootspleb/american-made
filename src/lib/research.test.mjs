import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadProposalsFromDisk, renderProposalSection } from './supply-proposals.mjs';
import {
  allowlistFor,
  extractProposals,
  geocodeStreetAddress,
  htmlToExcerpt,
  isKnownSupplier,
  loadManufacturerRecord,
  runResearch,
} from './research.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the Liberty allowlist is cited company, filing, and trade pages', () => {
  const record = loadManufacturerRecord(root, 'liberty-tabletop');
  assert.ok(record);
  const urls = allowlistFor(record).map((row) => row.url);
  assert.ok(urls.includes('https://libertytabletop.com/'));
  assert.ok(urls.some((url) => url.includes('prnewswire.com')));
  assert.equal(urls.some((url) => url.includes('businessinsider.com')), false);
  assert.equal(urls.some((url) => url.includes('epa.gov')), false);
});

test('an excerpt drops tags and stays short', () => {
  const excerpt = htmlToExcerpt('<style>body{}</style><p>Buys steel from <b>Mill</b>.</p>', 20);
  assert.equal(excerpt.includes('<'), false);
  assert.ok(excerpt.length <= 20);
});

test('an excerpt keeps the article and drops stylesheet text in a template', () => {
  const excerpt = htmlToExcerpt(
    '<title>T</title><template>:host { --shadow-border-radius-xs: 1rem; }</template><article><p>Liberty Tabletop buys stainless bar from Fixture Alloy Works.</p></article>',
  );
  assert.equal(excerpt.includes(':host'), false);
  assert.equal(excerpt.includes('Fixture Alloy Works'), true);
});

test('a trade thank-you names each new supplier', () => {
  const excerpt =
    'The truck hauls our Made in USA stainless steel from Pittsburgh or Tennessee to Ohio. Thank you, “family-owned” H&D Steel for being a reliable supplier. The other main inputs in flatware production are buffs and compounds that come from either Utica, New York, or Ohio. Thank you, family-owned Divine Brothers and Van Industries, for also being reliable suppliers.';
  const proposals = extractProposals({
    excerpt,
    sourceUrl: 'https://www.buydirectusa.com/made-in-america-flatware-has-no-supply-chain-issues/',
    customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
    knownSuppliers: [],
  });
  const byName = Object.fromEntries(proposals.map((proposal) => [proposal.supplier.name, proposal]));
  assert.deepEqual(Object.keys(byName).sort(), ['Divine Brothers', 'H&D Steel', 'Van Industries']);
  assert.equal(byName['H&D Steel'].id, 'liberty-tabletop--h-and-d-steel--stainless-steel');
  assert.equal(byName['H&D Steel'].input.key, 'stainless-steel');
  assert.equal(byName['H&D Steel'].confidence, 'medium');
  assert.equal(byName['Divine Brothers'].input.key, 'buffing-compounds');
  assert.equal(byName['Van Industries'].input.key, 'buffing-compounds');
  assert.match(byName['Divine Brothers'].quote, /buffs and compounds/);
});

test('a mill list keeps a new short name and skips mills already linked', () => {
  const known = [
    { slug: 'cleveland-cliffs', name: 'Cleveland-Cliffs Inc. (AK Steel lineage)' },
    { slug: 'ati', name: 'ATI Inc. (Allegheny Ludlum lineage)' },
  ];
  const proposals = extractProposals({
    excerpt:
      'All of our steel is sourced domestically. It could come from Allegheny Ludlum, it could come from AK Steel, and it could come from NASS, or another place down in Birmingham.',
    sourceUrl: 'https://www.americanmanufacturing.org/blog/liberty-sets-the-table-for-growth/',
    customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
    knownSuppliers: known,
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].supplier.name, 'NASS');
  assert.equal(proposals[0].supplier.slug, 'nass');
  assert.equal(proposals[0].confidence, 'low');
  assert.equal(proposals[0].input.key, 'stainless-steel');
});

test('a late supplier sentence is not glued to a cut-off lead', () => {
  const html = `<article><p>But the cost of making flatware keeps rising in this town. ${'word '.repeat(160)}The line keeps going. It could come from NASS, or another place down in Birmingham. "The Made in America thing is real."</p></article>`;
  const excerpt = htmlToExcerpt(html);
  const proposals = extractProposals({
    excerpt,
    sourceUrl: 'https://www.americanmanufacturing.org/blog/liberty-sets-the-table-for-growth/',
    customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
    knownSuppliers: [],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].quote, 'It could come from NASS, or another place down in Birmingham.');
  assert.equal(excerpt.includes('word word'), false);
});

test('an excerpt keeps a supplier sentence and an owner name past the lead', () => {
  const filler = 'Alpha '.repeat(180);
  const excerpt = htmlToExcerpt(
    `<article><p>${filler} For: Flatware, namely, forks. Owner Name: SHERRILL MANUFACTURING, INC. It could come from NASS.</p></article>`,
  );
  assert.equal(excerpt.includes('could come from NASS'), true);
  assert.equal(excerpt.includes('SHERRILL MANUFACTURING'), true);
  assert.equal(excerpt.includes('Flatware'), true);
  assert.ok(excerpt.length <= 1600);
});

test('a known mill name is not proposed again', () => {
  const known = [{ slug: 'cleveland-cliffs', name: 'Cleveland-Cliffs Inc. (AK Steel lineage)' }];
  assert.equal(isKnownSupplier('AK Steel', 'ak-steel', known), true);
  const proposals = extractProposals({
    excerpt: 'Owens said the steel could come from AK Steel.',
    sourceUrl: 'https://libertytabletop.com/',
    customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
    knownSuppliers: known,
  });
  assert.equal(proposals.length, 0);
});

test('fixture text proposes a new supplier and does not write a supply link', async () => {
  const writeRoot = mkdtempSync(nodePath.join(tmpdir(), 'forge-research-'));
  let network = false;
  const result = await runResearch({
    root,
    writeRoot,
    from: 'liberty-tabletop',
    fixture: true,
    fetchImpl: () => {
      network = true;
      throw new Error('fixture mode must not fetch');
    },
  });
  assert.equal(network, false);
  assert.equal(result.proposals.length, 1);
  const proposal = result.proposals[0];
  assert.equal(proposal.supplier.name, 'Fixture Alloy Works');
  assert.equal(proposal.supplier.website, 'https://fixture-alloy.example/');
  assert.equal(proposal.supplier.address, '100 Mill Road, Pittsburgh, PA 15201');
  assert.equal(proposal.confidence, 'medium');
  assert.equal(proposal.coordinates, undefined);
  assert.equal(
    result.wrote.some((file) => file.split(nodePath.sep).includes('supply-links')),
    false,
  );
  const loaded = loadProposalsFromDisk(writeRoot);
  assert.deepEqual(loaded.issues, []);
  const html = renderProposalSection(loaded.proposals);
  assert.match(html, /Fixture Alloy Works/);
  assert.match(html, /value="verify"/);
  assert.match(html, /value="reject"/);
  assert.match(html, /value="needs-source"/);
});

test('dry-run writes nothing and does not geocode', async () => {
  let network = false;
  const result = await runResearch({
    root,
    from: 'liberty-tabletop',
    dryRun: true,
    geocode: true,
    fetchImpl: () => {
      network = true;
      throw new Error('dry-run must not fetch');
    },
  });
  assert.equal(network, false);
  assert.equal(result.dryRun, true);
  assert.ok(result.allowlist.length > 0);
  assert.deepEqual(result.wrote, []);
});

test('geocoding fails closed without a street address and a source', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return { ok: true, json: async () => [] };
  };
  const missing = await geocodeStreetAddress({ address: 'Pittsburgh, PA', fetchImpl });
  assert.equal(missing.reason, 'no-street-address');
  const unsourced = await geocodeStreetAddress({ address: '100 Mill Road, Pittsburgh, PA 15201', fetchImpl });
  assert.equal(unsourced.reason, 'no-address-source');
  assert.equal(called, 0);

  const city = await geocodeStreetAddress({
    address: '100 Mill Road, Pittsburgh, PA 15201',
    addressSourceUrl: 'https://libertytabletop.com/',
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ lat: '40.4', lon: '-80.0', address: { city: 'Pittsburgh' } }],
    }),
  });
  assert.equal(city.reason, 'not-a-street');

  const hit = await geocodeStreetAddress({
    address: '100 Mill Road, Pittsburgh, PA 15201',
    addressSourceUrl: 'https://libertytabletop.com/',
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ lat: '40.441', lon: '-79.996', address: { house_number: '100', road: 'Mill Road' } }],
    }),
  });
  assert.equal(hit.ok, true);
  assert.equal(hit.lat, 40.441);
  assert.match(hit.geocodeSourceUrl, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
});
