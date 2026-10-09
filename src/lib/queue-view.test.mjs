import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countByForm,
  evidenceParts,
  filterByForm,
  normalizeSubmission,
  normalizeSubmissions,
  selectedForm,
} from './queue-view.mjs';

test('evidence links keep surrounding words and mark X permalinks', () => {
  const parts = evidenceParts(
    'Profile: https://american-forge.netlify.app/manufacturers/liberty-tabletop/ | X: https://x.com/example/status/1234567890.',
  );
  const links = parts.filter((part) => part.type === 'link');
  assert.equal(links.length, 2);
  assert.equal(links[0].href, 'https://american-forge.netlify.app/manufacturers/liberty-tabletop/');
  assert.equal(links[0].x, false);
  assert.equal(links[1].href, 'https://x.com/example/status/1234567890');
  assert.equal(links[1].x, true);
  assert.equal(
    parts.some((part) => part.type === 'text' && part.value.includes('Profile:')),
    true,
  );
});

test('a submission keeps review fields and drops the visitor ip', () => {
  const item = normalizeSubmission({
    id: 'sub-1',
    number: 4,
    form_name: 'review-request',
    created_at: '2026-10-01T03:01:54.977Z',
    email: 'person@example.com',
    data: {
      company: 'Liberty Tabletop',
      company_url: 'https://libertytabletop.com/',
      page: '/manufacturers/liberty-tabletop',
      name: 'Ada',
      email: 'person@example.com',
      body: 'Check the steel mills.',
      evidence: 'https://x.com/example/status/99\nhttps://example.com/filing',
      ip: '203.0.113.10',
      user_agent: 'Mozilla/5.0',
      'bot-field': 'spam',
    },
  });
  assert.ok(item);
  assert.equal(item.company, 'Liberty Tabletop');
  assert.equal(item.companyUrl, 'https://libertytabletop.com/');
  assert.equal(item.pageHref, '/manufacturers/liberty-tabletop');
  assert.equal(item.emailHref, 'person@example.com');
  assert.equal(item.formName, 'review-request');
  assert.equal(item.kind, 'Review request');
  assert.equal(item.number, 4);
  assert.equal(item.submittedAt.includes('UTC'), true);
  assert.equal(JSON.stringify(item).includes('203.0.113.10'), false);
  assert.equal(JSON.stringify(item).includes('Mozilla'), false);
  assert.equal(JSON.stringify(item).includes('bot-field'), false);
  assert.equal(item.evidenceParts.filter((part) => part.type === 'link' && part.x).length, 1);
});

test('unknown forms are ignored and the newest note is first', () => {
  const items = normalizeSubmissions([
    {
      id: 'old',
      form_name: 'page-submission',
      created_at: '2026-09-01T00:00:00.000Z',
      data: { type: 'edit', page: '/how-we-rate', body: 'Older' },
    },
    {
      id: 'spam-form',
      form_name: 'contact',
      created_at: '2026-10-02T00:00:00.000Z',
      data: { body: 'nope' },
    },
    {
      id: 'new',
      form_name: 'company-suggestion',
      created_at: '2026-10-01T00:00:00.000Z',
      data: {
        company: 'Example Works',
        company_url: 'javascript:alert(1)',
        place: 'Sherrill, NY',
        products: 'flatware',
        body: 'Newer',
      },
    },
  ]);
  assert.deepEqual(
    items.map((item) => item.id),
    ['new', 'old'],
  );
  assert.equal(items[0].companyUrl, '');
  assert.equal(items[0].place, 'Sherrill, NY');
  assert.equal(items[1].kind, 'Proposed edit');
  assert.equal(selectedForm('nope'), 'all');
  assert.equal(filterByForm(items, 'page-submission').length, 1);
  assert.deepEqual(countByForm(items), {
    all: 2,
    'review-request': 0,
    'company-suggestion': 1,
    'page-submission': 1,
  });
});
