import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { placeIssues } from './places.mjs';
import { deriveFlag, domesticShareByLine, exitsUs, loadSupplyLinksFromDisk, validateSupplyLinks } from './supply-links.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sample = JSON.parse(
  readFileSync(new URL('../data/supply-links/liberty-tabletop--ati--stainless-steel.json', import.meta.url), 'utf8'),
);
const manufacturers = new Set(['liberty-tabletop']);
const run = (raw, path = 'src/data/supply-links/liberty-tabletop--ati--stainless-steel.json') =>
  validateSupplyLinks([{ path, raw }], manufacturers).issues;

test('repository supply links are valid', () => {
  const { issues, links } = loadSupplyLinksFromDisk(root);
  assert.deepEqual(issues, []);
  assert.ok(links.length > 0);
});

test('flag follows input origins', () => {
  assert.equal(deriveFlag([{ country: 'US' }]), 'domestic');
  assert.equal(deriveFlag([{ country: 'ZA' }]), 'foreign');
  assert.equal(deriveFlag([{ country: 'US' }, { country: 'CA' }]), 'mixed');
  assert.equal(deriveFlag([{ country: 'unknown' }]), 'unknown');
  const wrong = structuredClone(sample);
  wrong.flag = 'foreign';
  assert.ok(run(wrong).some((m) => m.includes('flag')));
});

test('verified needs a source that names the supplier', () => {
  const link = structuredClone(sample);
  link.status = 'verified';
  assert.ok(run(link).some((m) => m.includes('namingSources')));
});

test('an unidentified supplier cannot be verified', () => {
  const link = structuredClone(sample);
  link.status = 'verified';
  link.supplier.identified = false;
  link.namingSources = ['aam'];
  assert.ok(run(link).some((m) => m.includes('not identified')));
});

test('every source must be cited and every citation must exist', () => {
  const link = structuredClone(sample);
  link.evidence.push('missing');
  assert.ok(run(link).some((m) => m.includes('"missing"')));
  const extra = structuredClone(sample);
  extra.sources.push({ ...extra.sources[0], id: 'unused' });
  assert.ok(run(extra).some((m) => m.includes('never cites')));
});

test('tier 1 must supply a manufacturer that exists', () => {
  const link = structuredClone(sample);
  link.tier = 2;
  assert.ok(run(link).some((m) => m.includes('tier must be 1')));
  const other = structuredClone(sample);
  other.customer.slug = 'nobody';
  assert.ok(run(other).some((m) => m.includes('no file')));
});

test('a tier 2 link needs its customer as a tier 1 supplier', () => {
  const upstream = structuredClone(sample);
  upstream.id = 'ati--example--nickel';
  upstream.customer = { type: 'supplier', slug: 'ati', name: 'ATI' };
  upstream.supplier = { ...upstream.supplier, slug: 'example' };
  upstream.tier = 2;
  const ok = validateSupplyLinks(
    [
      { path: 'src/data/supply-links/liberty-tabletop--ati--stainless-steel.json', raw: sample },
      { path: 'src/data/supply-links/ati--example--nickel.json', raw: upstream },
    ],
    manufacturers,
  );
  assert.deepEqual(ok.issues, []);
  upstream.tier = 3;
  const bad = validateSupplyLinks(
    [
      { path: 'src/data/supply-links/liberty-tabletop--ati--stainless-steel.json', raw: sample },
      { path: 'src/data/supply-links/ati--example--nickel.json', raw: upstream },
    ],
    manufacturers,
  );
  assert.ok(bad.issues.some((m) => m.includes('not a tier 2')));
});

test('places: sourced needs sources, coordinates need coordinate sources', () => {
  assert.ok(placeIssues({ country: 'US', status: 'sourced', sources: [] }).length > 0);
  assert.ok(placeIssues({ country: 'US', status: 'unverified', sources: [], lat: 1, lng: 2 }).length > 0);
  assert.deepEqual(
    placeIssues({ country: 'US', status: 'sourced', sources: ['a'], lat: 1, lng: 2, coordinateSources: ['a'] }),
    [],
  );
});

test('domestic share counts input lines and chain exits are reported', () => {
  const { links } = loadSupplyLinksFromDisk(root);
  const share = domesticShareByLine(links, 'liberty-tabletop');
  assert.equal(share.method, 'input lines');
  assert.equal(share.lines, 3);
  const nas = links.find((link) => link.supplier.slug === 'north-american-stainless');
  assert.ok(exitsUs(nas).some((reason) => reason.includes('parent')));
});
