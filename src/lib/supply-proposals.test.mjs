import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadProposalsForAdmin, loadProposalsFromDisk, renderProposalSection, validateProposals } from './supply-proposals.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the proposals directory matches the schema', () => {
  const loaded = loadProposalsFromDisk(root);
  assert.deepEqual(loaded.issues, []);
});

test('a proposal file has to match its id', () => {
  const { issues } = validateProposals(
    [
      {
        path: 'src/data/supply-proposals/other.json',
        raw: {
          id: 'liberty-tabletop--mill--stainless-steel',
          status: 'open',
          customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
          supplier: { slug: 'mill', name: 'Mill Co', identified: true },
          input: { key: 'stainless-steel', name: 'stainless steel' },
          tierHint: 1,
          quote: 'A sentence.',
          sourceUrl: 'https://example.com/page',
          confidence: 'low',
        },
      },
    ],
    new Set(['liberty-tabletop']),
  );
  assert.equal(issues.some((issue) => issue.includes('must use id')), true);
});

test('the admin section names a proposal and its actions', () => {
  const html = renderProposalSection([
    {
      id: 'liberty-tabletop--mill--stainless-steel',
      status: 'open',
      customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
      supplier: { slug: 'mill', name: 'Mill Co', identified: true },
      input: { key: 'stainless-steel', name: 'stainless steel' },
      tierHint: 1,
      quote: 'Buys from Mill Co.',
      sourceUrl: 'https://example.com/page',
      confidence: 'low',
    },
  ]);
  assert.match(html, /Mill Co/);
  assert.match(html, /value="verify"/);
  assert.match(html, /value="reject"/);
  assert.match(html, /value="needs-source"/);
  assert.match(html, /action="\/api\/admin\/proposals"/);
});

test('a host with manufacturer files and no proposal directory uses the bundle', () => {
  const host = mkdtempSync(nodePath.join(tmpdir(), 'forge-proposal-host-'));
  mkdirSync(nodePath.join(host, 'src/data/manufacturers'), { recursive: true });
  writeFileSync(nodePath.join(host, 'src/data/manufacturers/liberty-tabletop.json'), '{"slug":"liberty-tabletop"}\n');
  const bundled = [
    {
      id: 'liberty-tabletop--h-and-d-steel--stainless-steel',
      status: 'open',
      customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
      supplier: { slug: 'h-and-d-steel', name: 'H&D Steel', identified: true },
      input: { key: 'stainless-steel', name: 'stainless steel' },
      tierHint: 1,
      quote: 'Thank you, H&D Steel for being a reliable supplier.',
      sourceUrl: 'https://www.buydirectusa.com/made-in-america-flatware-has-no-supply-chain-issues/',
      confidence: 'medium',
    },
  ];
  const loaded = loadProposalsForAdmin(host, bundled);
  assert.equal(loaded.source, 'bundle');
  assert.equal(loaded.proposals.length, 1);
  assert.equal(loaded.proposals[0].supplier.name, 'H&D Steel');

  const checkout = loadProposalsForAdmin(root, bundled);
  assert.equal(checkout.source, 'disk');
  assert.equal(checkout.proposals.some((proposal) => proposal.supplier.name === 'H&D Steel'), true);
});
