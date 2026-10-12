import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { domesticShareByLine, exitsUs, loadSupplyLinksFromDisk } from './supply-links.mjs';
import { loadSupplyGraphFromDisk } from './load-supply-graph.mjs';
import {
  buildSupplyGraph,
  filterSupplyGraph,
  primaryLocation,
  sourcedCoordinate,
} from './supply-graph.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

function place(overrides = {}) {
  return { country: 'US', status: 'sourced', sources: ['a'], ...overrides };
}

function link(overrides = {}) {
  const supplier = overrides.supplier ?? {
    slug: 'mill',
    name: 'Mill',
    identified: true,
    hq: place({ city: 'Ghent', region: 'KY' }),
  };
  return {
    id: overrides.id ?? 'liberty-tabletop--mill--steel',
    customer: overrides.customer ?? { type: 'manufacturer', slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
    supplier,
    input: overrides.input ?? { key: 'steel', name: 'Steel', origins: [place()] },
    tier: overrides.tier ?? 1,
    flag: overrides.flag ?? 'domestic',
    status: overrides.status ?? 'unverified',
    statusNote: overrides.statusNote ?? 'Example only.',
    sources: overrides.sources ?? [{ id: 'a', title: 'A source', publisher: 'Publisher', url: 'https://example.com/a' }],
  };
}

const liberty = {
  slug: 'liberty-tabletop',
  name: 'Liberty Tabletop',
  status: 'published',
  website: 'https://libertytabletop.com/',
  hq: place({ city: 'Sherrill', region: 'NY' }),
  location: { city: 'Sherrill', region: 'New York', country: 'United States' },
};

test('sourced coordinates require a sourced place and coordinateSources', () => {
  assert.equal(sourcedCoordinate(place({ city: 'Sherrill' })), null);
  assert.equal(sourcedCoordinate(place({ lat: 43, lng: -75 })), null);
  assert.equal(sourcedCoordinate({ country: 'US', status: 'unverified', sources: [], lat: 43, lng: -75, coordinateSources: ['a'] }), null);
  assert.equal(sourcedCoordinate(place({ lat: 43, coordinateSources: ['a'] })), null);
  assert.equal(sourcedCoordinate(place({ lat: 120, lng: 10, coordinateSources: ['a'] })), null);
  assert.deepEqual(sourcedCoordinate(place({ lat: 43.07, lng: -75.6, coordinateSources: ['a'] })), {
    lat: 43.07,
    lng: -75.6,
  });
});

test('draft manufacturers and their suppliers stay off the graph', () => {
  const graph = buildSupplyGraph({
    manufacturers: [
      liberty,
      {
        slug: 'appalachian-manufacturing',
        name: 'Appalachian Manufacturing Co.',
        status: 'draft',
        hq: place({ lat: 40, lng: -77, coordinateSources: ['a'] }),
      },
    ],
    links: [
      link(),
      link({
        id: 'appalachian-manufacturing--secret-mill--steel',
        customer: { type: 'manufacturer', slug: 'appalachian-manufacturing', name: 'Appalachian Manufacturing Co.' },
        supplier: {
          slug: 'secret-mill',
          name: 'Secret Mill',
          identified: true,
          hq: place({ lat: 1, lng: 2, coordinateSources: ['a'] }),
        },
      }),
      link({
        id: 'secret-mill--ore--iron',
        customer: { type: 'supplier', slug: 'secret-mill', name: 'Secret Mill' },
        supplier: { slug: 'ore', name: 'Ore Pit', identified: true, hq: place({ country: 'ZA' }) },
        tier: 2,
        flag: 'foreign',
      }),
    ],
  });
  const encoded = JSON.stringify(graph);
  assert.equal(encoded.includes('appalachian'), false);
  assert.equal(encoded.includes('Secret Mill'), false);
  assert.equal(encoded.includes('Ore Pit'), false);
  assert.deepEqual(
    graph.nodes.map((node) => node.slug),
    ['liberty-tabletop', 'mill'],
  );
});

test('a city without coordinates is not pinned', () => {
  const graph = buildSupplyGraph({ manufacturers: [liberty], links: [link()] });
  for (const node of graph.nodes) {
    assert.equal(node.located, false);
    assert.deepEqual(node.locations, []);
    assert.equal(Object.hasOwn(node, 'lat'), false);
    assert.equal(JSON.stringify(node).includes('"lat"'), false);
  }
  assert.equal(primaryLocation(graph.nodes[0]), null);
  assert.equal(graph.nodes.find((node) => node.slug === 'liberty-tabletop').placeLabel, 'Sherrill, NY, United States');
});

test('facility and headquarters coordinates are kept and parent coordinates are not', () => {
  const graph = buildSupplyGraph({
    manufacturers: [
      {
        ...liberty,
        hq: place({ city: 'Sherrill', region: 'NY' }),
        facilities: [
          {
            id: 'sherrill-plant',
            name: 'Sherrill plant',
            kind: 'manufacturing',
            place: place({ city: 'Sherrill', region: 'NY', lat: 43.07, lng: -75.6, coordinateSources: ['a'] }),
          },
        ],
      },
    ],
    links: [
      link({
        supplier: {
          slug: 'mill',
          name: 'Mill',
          identified: true,
          hq: place({ city: 'Ghent', region: 'KY', lat: 38.73, lng: -84.91, coordinateSources: ['a'] }),
          parent: {
            name: 'Parent Co',
            hq: place({ country: 'ES', city: 'Madrid', lat: 40.4, lng: -3.7, coordinateSources: ['a'] }),
          },
        },
      }),
    ],
  });
  const libertyNode = graph.nodes.find((node) => node.slug === 'liberty-tabletop');
  const mill = graph.nodes.find((node) => node.slug === 'mill');
  assert.equal(libertyNode.located, true);
  assert.deepEqual(primaryLocation(libertyNode), {
    id: 'sherrill-plant',
    name: 'Sherrill plant',
    kind: 'manufacturing',
    lat: 43.07,
    lng: -75.6,
    label: 'Sherrill, NY, United States',
  });
  assert.equal(JSON.stringify(libertyNode.locations).includes('-3.7'), false);
  assert.deepEqual(mill.locations.map((location) => [location.lat, location.lng]), [[38.73, -84.91]]);
  assert.equal(mill.parent.name, 'Parent Co');
  assert.equal(mill.parent.country, 'ES');
  assert.equal(JSON.stringify(mill.locations).includes('-3.7'), false);
});

test('edges run from supplier to customer and unverified links are dashed', () => {
  const graph = buildSupplyGraph({
    manufacturers: [liberty],
    links: [
      link({ status: 'unverified', flag: 'domestic' }),
      link({
        id: 'mill--ore--iron',
        customer: { type: 'supplier', slug: 'mill', name: 'Mill' },
        supplier: { slug: 'ore', name: 'Ore', identified: true, hq: place({ country: 'ZA' }) },
        tier: 2,
        flag: 'foreign',
        status: 'verified',
        statusNote: 'Named in a filing.',
      }),
    ],
  });
  const tier1 = graph.edges.find((edge) => edge.tier === 1);
  const tier2 = graph.edges.find((edge) => edge.tier === 2);
  assert.equal(tier1.source, 'supplier:mill');
  assert.equal(tier1.target, 'manufacturer:liberty-tabletop');
  assert.equal(tier1.dashed, true);
  assert.equal(tier1.color, '#24362e');
  assert.equal(tier2.source, 'supplier:ore');
  assert.equal(tier2.target, 'supplier:mill');
  assert.equal(tier2.dashed, false);
  assert.equal(tier2.flag, 'foreign');
  assert.equal(graph.nodes.find((node) => node.slug === 'ore').hqCountry, 'ZA');
  assert.equal(graph.nodes.find((node) => node.slug === 'ore').colorKey, 'foreign');
  assert.equal(graph.nodes.find((node) => node.slug === 'mill').tierLabel, 'Tier 1');
  assert.equal(graph.nodes.find((node) => node.slug === 'liberty-tabletop').domesticShareLabel.includes('1 of 1'), true);
});

test('filters by tier, origin, and company name', () => {
  const graph = buildSupplyGraph({
    manufacturers: [liberty, { slug: 'other-mill', name: 'Other Mill Co', status: 'published' }],
    links: [
      link(),
      link({
        id: 'mill--ore--iron',
        customer: { type: 'supplier', slug: 'mill', name: 'Mill' },
        supplier: { slug: 'ore', name: 'Ore', identified: true, hq: place({ country: 'ZA' }) },
        tier: 2,
        flag: 'foreign',
      }),
    ],
  });
  const before = graph.nodes.length;
  const tier2 = filterSupplyGraph(graph, { tier: '2' });
  assert.deepEqual(
    tier2.nodes.map((node) => node.slug).sort(),
    ['mill', 'ore'],
  );
  const foreign = filterSupplyGraph(graph, { flag: 'foreign' });
  assert.equal(foreign.edges.length, 1);
  assert.equal(foreign.edges[0].flag, 'foreign');
  const found = filterSupplyGraph(graph, { query: 'LIBERTY' });
  assert.ok(found.nodes.some((node) => node.slug === 'liberty-tabletop'));
  assert.ok(found.nodes.some((node) => node.slug === 'mill'));
  assert.equal(found.nodes.some((node) => node.slug === 'ore'), false);
  assert.equal(filterSupplyGraph(graph, { query: 'ore' }).nodes.some((node) => node.slug === 'liberty-tabletop'), false);
  assert.equal(filterSupplyGraph(graph, { query: 'nobody' }).nodes.length, 0);
  assert.equal(filterSupplyGraph(graph, { query: 'other' }).nodes[0].slug, 'other-mill');
  assert.equal(graph.nodes.length, before);
});

test('repository graph matches the files and leaves drafts off', () => {
  const graph = loadSupplyGraphFromDisk(root);
  const encoded = JSON.stringify(graph);
  assert.equal(encoded.toLowerCase().includes('appalachian'), false);
  assert.ok(graph.nodes.some((node) => node.slug === 'liberty-tabletop'));
  assert.ok(graph.nodes.length > 1);
  assert.ok(graph.edges.length > 0);
  assert.ok(graph.nodes.every((node) => node.located === false));
  assert.ok(graph.edges.every((edge) => edge.dashed === true));
  assert.ok(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.source)));
  assert.ok(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.target)));

  const manufacturerDir = nodePath.join(root, 'src/data/manufacturers');
  const slugs = new Set(
    readdirSync(manufacturerDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(nodePath.join(manufacturerDir, name), 'utf8')))
      .filter((profile) => profile.status !== 'draft')
      .map((profile) => profile.slug),
  );
  for (const node of graph.nodes) {
    if (node.kind === 'manufacturer') assert.ok(slugs.has(node.slug));
  }

  const libertyNode = graph.nodes.find((node) => node.slug === 'liberty-tabletop');
  const { links } = loadSupplyLinksFromDisk(root);
  assert.deepEqual(libertyNode.domesticShare, domesticShareByLine(links, 'liberty-tabletop'));
  assert.match(libertyNode.domesticShareLabel, /3 of 3 input lines domestic/);

  const nas = graph.edges.find((edge) => edge.id.includes('north-american-stainless'));
  assert.ok(nas.exitsUs.some((reason) => reason.includes('parent')));
  assert.equal(nas.flag, 'domestic');
  const nasNode = graph.nodes.find((node) => node.slug === 'north-american-stainless');
  assert.equal(nasNode.parent.country, 'ES');
  assert.equal(nasNode.sources.some((source) => source.url.startsWith('https://')), true);

  const rawNas = JSON.parse(
    readFileSync(new URL('../data/supply-links/liberty-tabletop--north-american-stainless--stainless-steel.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(nas.exitsUs, exitsUs(rawNas));
});
