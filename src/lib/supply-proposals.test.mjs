import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadProposalsFromDisk, renderProposalSection, validateProposals } from './supply-proposals.mjs';

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
