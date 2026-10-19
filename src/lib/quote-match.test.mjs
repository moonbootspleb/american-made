import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkQuoteInHtml, findQuote, htmlToBlocks, normalizeWithMap, pageMeta, textFragmentUrl } from './quote-match.mjs';

const fixture = readFileSync(new URL('../data/research-fixtures/source-view/flatware-page.html', import.meta.url), 'utf8');

test('normalizeWithMap folds curly quotes, dashes, case, and whitespace and maps back to the input', () => {
  const { text, map } = normalizeWithMap('  “Family–Owned”\n\tSteel ');
  assert.equal(text, '"family-owned" steel');
  assert.equal(map.length, text.length);
  assert.equal('  “Family–Owned”\n\tSteel '[map[text.indexOf('steel')]], 'S');
});

test('findQuote: exact, normalized, trimmed, and a miss', () => {
  assert.equal(findQuote('a b c', 'b c').method, 'exact');
  const curly = findQuote('Thank you, “family-owned” Steel.', 'thank you, "family-owned" steel');
  assert.equal(curly.found, true);
  assert.equal(curly.method, 'normalized');
  assert.equal(curly.matched, 'Thank you, “family-owned” Steel');
  const trailing = findQuote('He said it could come from NASS. Then he left.', '"It could come from NASS."');
  assert.equal(trailing.found, true);
  assert.equal(trailing.method, 'trimmed');
  const miss = findQuote('Nothing about suppliers here.', 'Fixture Steel supplies bar.');
  assert.deepEqual([miss.found, miss.method, miss.start], [false, 'none', -1]);
});

test('checkQuoteInHtml finds a quote across inline tags and names the heading and paragraph', () => {
  const quote =
    'Thank you, "family-owned" Fixture Steel for being a reliable supplier. The other main inputs are buffs and compounds that come from either Utica, New York, or Ohio.';
  const result = checkQuoteInHtml(fixture, quote);
  assert.equal(result.found, true);
  assert.equal(result.heading, 'Fixture Flatware Supply Page');
  assert.equal(result.paragraph, 2);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.title, 'Fixture Flatware Supply Page');
  assert.equal(result.publisher, 'Fixture Publisher');
  assert.equal(result.published, '2022-01-01T00:16:00+00:00');

  const second = checkQuoteInHtml(fixture, 'It could come from Fixture Mill A, or another place down in Birmingham."');
  assert.equal(second.found, true);
  assert.equal(second.heading, 'Second section');
  assert.equal(second.paragraph, 2);
});

test('checkQuoteInHtml never invents a location for a missing quote', () => {
  const result = checkQuoteInHtml(fixture, 'Fixture Steel ships nickel to the moon.');
  assert.equal(result.found, false);
  assert.equal(result.paragraph, 0);
  assert.equal(result.heading, '');
  assert.equal(result.context, '');
});

test('script text is not page text', () => {
  const page = htmlToBlocks(fixture);
  assert.equal(page.text.includes('document.cookie'), false);
  assert.equal(pageMeta('<p>no meta</p>').title, '');
});

test('textFragmentUrl uses start and end words and encodes the fragment syntax', () => {
  assert.equal(
    textFragmentUrl('https://example.com/a#old', 'Thank you, “family-owned” H&D Steel for being a reliable supplier.'),
    'https://example.com/a#:~:text=Thank%20you%2C%20%E2%80%9Cfamily%2Downed%E2%80%9D%20H%26D,being%20a%20reliable%20supplier.',
  );
  assert.equal(textFragmentUrl('https://example.com/', 'short quote'), 'https://example.com/#:~:text=short%20quote');
});
