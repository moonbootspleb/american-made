import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import test from 'node:test';
import { placeIssues } from './places.mjs';
import { applyProposalAction, researchWritesAllowed } from './proposal-actions.mjs';

/**
 * @param {Record<string, unknown>} [extra]
 */
function proposal(extra = {}) {
  return {
    id: 'liberty-tabletop--fixture-alloy-works--stainless-steel',
    status: 'open',
    customer: { slug: 'liberty-tabletop', name: 'Liberty Tabletop' },
    supplier: {
      slug: 'fixture-alloy-works',
      name: 'Fixture Alloy Works',
      identified: true,
      website: 'https://fixture-alloy.example/',
      address: '100 Mill Road, Pittsburgh, PA 15201',
      city: 'Pittsburgh',
      region: 'PA',
      country: 'US',
    },
    input: { key: 'stainless-steel', name: 'stainless steel' },
    tierHint: 1,
    quote: 'Liberty Tabletop buys stainless bar from Fixture Alloy Works.',
    sourceUrl: 'https://libertytabletop.com/',
    addressSourceUrl: 'https://libertytabletop.com/',
    confidence: 'medium',
    fetchedAt: '2026-10-15T00:00:00.000Z',
    ...extra,
  };
}

/**
 * @param {Record<string, unknown>} [raw]
 */
function checkout(raw = proposal()) {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'forge-act-'));
  mkdirSync(nodePath.join(root, 'src/data/manufacturers'), { recursive: true });
  mkdirSync(nodePath.join(root, 'src/data/supply-links'), { recursive: true });
  mkdirSync(nodePath.join(root, 'src/data/supply-proposals'), { recursive: true });
  writeFileSync(nodePath.join(root, 'src/data/manufacturers/liberty-tabletop.json'), '{}\n');
  writeFileSync(
    nodePath.join(root, 'src/data/supply-proposals', `${raw.id}.json`),
    `${JSON.stringify(raw, null, 2)}\n`,
  );
  return root;
}

test('reject and needs-source do not write a supply link', () => {
  const root = checkout();
  const rejected = applyProposalAction({ root, id: proposal().id, action: 'reject', today: '2026-10-15' });
  assert.equal(rejected.reason, 'rejected');
  assert.equal(existsSync(nodePath.join(root, 'src/data/supply-links', `${proposal().id}.json`)), false);
  assert.equal(existsSync(nodePath.join(root, 'src/data/manufacturers/fixture-alloy-works.json')), false);

  const again = checkout();
  const needs = applyProposalAction({ root: again, id: proposal().id, action: 'needs-source', today: '2026-10-15' });
  assert.equal(needs.reason, 'needs-source');
  const saved = JSON.parse(readFileSync(nodePath.join(again, 'src/data/supply-proposals', `${proposal().id}.json`), 'utf8'));
  assert.equal(saved.status, 'needs-source');
  assert.equal(existsSync(nodePath.join(again, 'src/data/supply-links', `${proposal().id}.json`)), false);
});

test('verify writes an unverified link and a draft profile', () => {
  const root = checkout();
  const result = applyProposalAction({ root, id: proposal().id, action: 'verify', today: '2026-10-15' });
  assert.equal(result.reason, 'filed');
  assert.equal(result.profile, 'draft');
  const link = JSON.parse(readFileSync(nodePath.join(root, 'src/data/supply-links', `${proposal().id}.json`), 'utf8'));
  assert.equal(link.status, 'unverified');
  assert.deepEqual(link.namingSources, []);
  assert.equal(link.flag, 'unknown');
  assert.equal(link.supplier.hq.lat, undefined);
  const profile = JSON.parse(readFileSync(nodePath.join(root, 'src/data/manufacturers/fixture-alloy-works.json'), 'utf8'));
  assert.equal(profile.status, 'draft');
  assert.equal(profile.categories[0], 'upstream-suppliers');
  assert.equal(existsSync(nodePath.join(root, 'public/manufacturers/fixture-alloy-works/mark.svg')), true);
  assert.deepEqual(placeIssues(profile.hq), []);
  const cited = new Set();
  for (const block of [...profile.lede, ...profile.openQuestions]) {
    for (const id of block.sources) cited.add(id);
  }
  for (const section of profile.sections) {
    for (const block of section.paragraphs) for (const id of block.sources) cited.add(id);
  }
  for (const entry of profile.changelog) for (const id of entry.sources) cited.add(id);
  for (const id of profile.hq.sources) cited.add(id);
  for (const source of profile.sources) assert.equal(cited.has(source.id), true);

  const second = applyProposalAction({ root, id: proposal().id, action: 'verify', today: '2026-10-15' });
  assert.equal(second.reason, 'already-closed');
});

test('verify without a company site still files the link and skips the profile', () => {
  const raw = proposal();
  delete raw.supplier.website;
  const root = checkout(raw);
  const result = applyProposalAction({ root, id: raw.id, action: 'verify', today: '2026-10-15' });
  assert.equal(result.reason, 'filed');
  assert.equal(result.profile, 'unchanged');
  assert.equal(existsSync(nodePath.join(root, 'src/data/manufacturers/fixture-alloy-works.json')), false);
  const link = JSON.parse(readFileSync(nodePath.join(root, 'src/data/supply-links', `${raw.id}.json`), 'utf8'));
  assert.equal(link.status, 'unverified');
});

test('a readonly host does not write', () => {
  const root = checkout();
  const result = applyProposalAction({
    root,
    id: proposal().id,
    action: 'verify',
    writesAllowed: false,
    today: '2026-10-15',
  });
  assert.equal(result.reason, 'host-readonly');
  assert.equal(existsSync(nodePath.join(root, 'src/data/supply-links', `${proposal().id}.json`)), false);
  assert.equal(researchWritesAllowed({ NETLIFY: 'true' }), false);
  assert.equal(researchWritesAllowed({ CONTEXT: 'production' }), false);
  assert.equal(researchWritesAllowed({}), true);
});

test('a decision with a review record stores it on the proposal and appends the audit log', async () => {
  const { buildReviewRecord } = await import('./review-audit.mjs');
  const root = checkout();
  const review = buildReviewRecord({
    proposal: proposal(),
    decision: 'verify',
    reviewer: 'Boots',
    check: { ok: true, sha256: 'b'.repeat(64), found: true },
    now: new Date('2026-10-19T22:00:00Z'),
  });
  const result = applyProposalAction({ root, id: proposal().id, action: 'verify', today: '2026-10-19', review });
  assert.equal(result.reason, 'filed');
  const saved = JSON.parse(readFileSync(nodePath.join(root, 'src/data/supply-proposals', `${proposal().id}.json`), 'utf8'));
  assert.equal(saved.review.decision, 'verify');
  assert.equal(saved.review.liveTextSha256, 'b'.repeat(64));
  assert.equal(saved.review.quoteFound, true);
  const log = readFileSync(nodePath.join(root, 'src/data/review-audit', `${proposal().id}.jsonl`), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0]).reviewer, 'Boots');
});
