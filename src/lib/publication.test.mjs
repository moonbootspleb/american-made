import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftManufacturers,
  isPublishedManufacturer,
  publishedManufacturers,
} from './publication.mjs';

test('omitted and published status stay on the public list', () => {
  assert.equal(isPublishedManufacturer({ status: undefined }), true);
  assert.equal(isPublishedManufacturer({}), true);
  assert.equal(isPublishedManufacturer({ status: 'published' }), true);
});

test('draft and unknown status stay off the public list', () => {
  assert.equal(isPublishedManufacturer({ status: 'draft' }), false);
  assert.equal(isPublishedManufacturer({ status: 'Draft' }), false);
  assert.equal(isPublishedManufacturer({ status: '' }), false);
  assert.equal(isPublishedManufacturer(null), false);
  assert.equal(isPublishedManufacturer(undefined), false);
});

test('public and draft lists do not share a company', () => {
  const records = [
    { slug: 'liberty-tabletop', status: 'published' },
    { slug: 'older', status: undefined },
    { slug: 'appalachian-manufacturing', status: 'draft' },
    { slug: 'nope', status: 'hidden' },
  ];
  assert.deepEqual(
    publishedManufacturers(records).map((profile) => profile.slug),
    ['liberty-tabletop', 'older'],
  );
  assert.deepEqual(
    draftManufacturers(records).map((profile) => profile.slug),
    ['appalachian-manufacturing'],
  );
  assert.deepEqual(publishedManufacturers(null), []);
  assert.deepEqual(draftManufacturers('draft'), []);
});
