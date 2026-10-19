import assert from 'node:assert/strict';
import test from 'node:test';
import { autoGaps, claimSentence, reviewGaps } from './proposal-review.mjs';
import { buildReviewRecord } from './review-audit.mjs';

const base = {
  id: 'liberty-tabletop--divine-brothers--buffing-compounds',
  quote:
    'The other main inputs in flatware production are buffs and compounds that come from either Utica, New York, or Ohio. Thank you, family-owned Divine Brothers and Van Industries, for also being reliable suppliers.',
  sourceUrl: 'https://www.buydirectusa.com/made-in-america-flatware-has-no-supply-chain-issues/',
  supplier: { name: 'Divine Brothers' },
  customer: { name: 'Liberty Tabletop' },
  input: { name: 'buffing compounds' },
};
const van = { ...base, id: 'liberty-tabletop--van-industries--buffing-compounds', supplier: { name: 'Van Industries' } };

test('claimSentence is one plain sentence, with place when on file, and honors an explicit claim', () => {
  assert.equal(claimSentence(base), 'Divine Brothers supplies buffing compounds to Liberty Tabletop.');
  assert.equal(
    claimSentence({ ...base, supplier: { name: 'Divine Brothers', city: 'Utica', region: 'NY' } }),
    'Divine Brothers (Utica, NY) supplies buffing compounds to Liberty Tabletop.',
  );
  assert.equal(claimSentence({ ...base, claim: 'Custom claim.' }), 'Custom claim.');
});

test('autoGaps notes a shared quote that names two suppliers and a missing customer name', () => {
  const gaps = autoGaps(base, [base, van], new Date('2026-10-19T00:00:00Z'));
  assert.ok(gaps.some((gap) => gap.includes('Divine Brothers and Van Industries')));
  assert.ok(gaps.some((gap) => gap.includes('does not name Liberty Tabletop')));
  assert.equal(gaps.some((gap) => gap.includes('hedged')), false);
});

test('autoGaps notes hedged language, a missing input, and an old page', () => {
  const nass = {
    ...base,
    id: 'x--nass--stainless-steel',
    quote: 'It could come from Allegheny Ludlum, it could come from AK Steel, and it could come from NASS.',
    supplier: { name: 'NASS' },
    input: { name: 'stainless steel' },
    sourceCheck: { published: '2015-11-09T20:39:21+00:00' },
  };
  const gaps = autoGaps(nass, [nass], new Date('2026-10-19T00:00:00Z'));
  assert.ok(gaps.some((gap) => gap.includes('hedged ("could")')));
  assert.ok(gaps.some((gap) => gap.includes('published 2015-11-09')));
  const hd = { ...base, quote: 'Thank you, “family-owned” H&D Steel for being a reliable supplier.', supplier: { name: 'H&D Steel' }, input: { name: 'stainless steel' } };
  assert.ok(autoGaps(hd, [hd]).some((gap) => gap.includes('does not mention stainless steel')));
});

test('reviewGaps adds research gaps after automatic ones without duplicates', () => {
  const gaps = reviewGaps({ ...base, gaps: ['Research gap.', 'Research gap.'] }, [base]);
  assert.equal(gaps.filter((gap) => gap === 'Research gap.').length, 1);
});

test('buildReviewRecord holds the audit fields and the live check, and records a failed fetch as unknown', () => {
  const now = new Date('2026-10-19T21:50:00Z');
  const record = buildReviewRecord({
    proposal: base,
    decision: 'verify',
    reviewer: ' Boots ',
    note: 'Read in context.',
    viewerQuoteFound: 'true',
    check: { ok: true, sha256: 'a'.repeat(64), found: true },
    now,
  });
  assert.deepEqual(record, {
    proposalId: base.id,
    decision: 'verify',
    reviewer: 'Boots',
    decidedAt: '2026-10-19T21:50:00.000Z',
    sourceUrl: base.sourceUrl,
    claim: 'Divine Brothers supplies buffing compounds to Liberty Tabletop.',
    quote: base.quote,
    liveTextSha256: 'a'.repeat(64),
    quoteFound: true,
    viewerQuoteFound: true,
    note: 'Read in context.',
  });
  const failed = buildReviewRecord({ proposal: base, decision: 'reject', check: { ok: false, error: 'HTTP 503' }, now });
  assert.equal(failed.reviewer, 'admin');
  assert.equal(failed.liveTextSha256, null);
  assert.equal(failed.quoteFound, null);
  assert.equal(failed.fetchError, 'HTTP 503');
  assert.throws(() => buildReviewRecord({ proposal: base, decision: 'publish', check: { ok: false }, now }));
});
