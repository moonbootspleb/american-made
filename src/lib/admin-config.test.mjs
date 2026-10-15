import assert from 'node:assert/strict';
import test from 'node:test';
import { PROD_SITE_ID, configuredToken, resolveSiteId, submissionsUrl } from './admin-config.mjs';

const OTHER = '66681ebf-5a78-4af1-acb7-0d655a8e62a9';

test('site id prefers the env value, then Netlify SITE_ID, then production', () => {
  assert.deepEqual(resolveSiteId({ NETLIFY_SITE_ID: OTHER, SITE_ID: PROD_SITE_ID }), {
    id: OTHER,
    source: 'NETLIFY_SITE_ID',
  });
  assert.deepEqual(resolveSiteId({ SITE_ID: OTHER }), { id: OTHER, source: 'SITE_ID' });
  assert.deepEqual(resolveSiteId({}), { id: PROD_SITE_ID, source: 'fallback' });
  assert.deepEqual(resolveSiteId({ NETLIFY_SITE_ID: 'not-a-site' }), { error: 'invalid' });
  assert.deepEqual(resolveSiteId({ SITE_ID: 'not-a-site' }), { id: PROD_SITE_ID, source: 'fallback' });
});

test('tokens that are short or placeholders are unset', () => {
  assert.equal(configuredToken(''), undefined);
  assert.equal(configuredToken('nf_short'), undefined);
  assert.equal(configuredToken('your_token_is_not_this_one'), undefined);
  assert.equal(configuredToken('placeholder-token-value-xxx'), undefined);
  assert.equal(configuredToken('nf_' + 'a'.repeat(30)), 'nf_' + 'a'.repeat(30));
});

test('the submissions URL does not carry the token', () => {
  const url = submissionsUrl(PROD_SITE_ID, 2);
  assert.equal(url.origin, 'https://api.netlify.com');
  assert.equal(url.pathname, `/api/v1/sites/${PROD_SITE_ID}/submissions`);
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.search.includes('token'), false);
});
