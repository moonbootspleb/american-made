import { createHash } from 'node:crypto';

/**
 * Find a proposal quote in a live source page.
 * The same normalizer runs on the server (page text) and inside the source viewer (DOM text nodes),
 * so a quote counts as found only when its words appear in that order on the page.
 * Nothing here invents a location. A miss is reported as a miss.
 */

/**
 * Normalize text for matching and keep a map from each normalized character to its index in the input.
 * Curly quotes, dashes, non-breaking spaces, and runs of whitespace are folded. Case is folded.
 * This function must stay self-contained: the source viewer injects its source text into the page.
 * @param {string} input
 * @returns {{ text: string, map: number[] }}
 */
export function normalizeWithMap(input) {
  const source = String(input);
  let text = '';
  /** @type {number[]} */
  const map = [];
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    let ch = source[index];
    if (/[\u2018\u2019\u201a\u201b\u2032\u0060\u00b4]/.test(ch)) ch = "'";
    else if (/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/.test(ch)) ch = '"';
    else if (/[\u2010-\u2015\u2212]/.test(ch)) ch = '-';
    else if (/[\u2026]/.test(ch)) ch = '.';
    else if (/[\u00ad\u200b-\u200d\ufeff]/.test(ch)) continue;
    if (/\s/.test(ch) || ch === '\u00a0') {
      if (text.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(index);
      pendingSpace = false;
    }
    text += ch.toLowerCase();
    map.push(index);
  }
  return { text, map };
}

/**
 * Strip quote marks and trailing punctuation from the ends of a quote.
 * Research quotes often carry a closing quote mark that belongs to the page, not the sentence.
 * @param {string} normalized
 */
function trimEnds(normalized) {
  return normalized.replace(/^["'\s]+/, '').replace(/["'\s]+$/, '');
}

/**
 * @param {string} text page text
 * @param {string} quote proposal quote
 * @returns {{ found: boolean, method: 'exact' | 'normalized' | 'trimmed' | 'none', start: number, end: number, matched: string }}
 */
export function findQuote(text, quote) {
  const page = String(text);
  const wanted = String(quote);
  if (!wanted.trim()) return { found: false, method: 'none', start: -1, end: -1, matched: '' };
  const direct = page.indexOf(wanted);
  if (direct >= 0) {
    return { found: true, method: 'exact', start: direct, end: direct + wanted.length, matched: wanted };
  }
  const hay = normalizeWithMap(page);
  const needle = normalizeWithMap(wanted).text;
  for (const [method, value] of /** @type {const} */ ([
    ['normalized', needle],
    ['trimmed', trimEnds(needle)],
  ])) {
    if (!value) continue;
    const at = hay.text.indexOf(value);
    if (at >= 0) {
      const start = hay.map[at];
      const end = hay.map[at + value.length - 1] + 1;
      return { found: true, method, start, end, matched: page.slice(start, end) };
    }
  }
  return { found: false, method: 'none', start: -1, end: -1, matched: '' };
}

/**
 * @param {string} value
 */
function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => safeChar(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeChar(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&ldquo;/gi, '\u201c')
    .replace(/&rdquo;/gi, '\u201d')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&hellip;/gi, '\u2026')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/**
 * @param {number} code
 */
function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' ';
  }
}

const BLOCK = /^(p|div|li|h[1-6]|blockquote|section|article|header|footer|tr|td|th|figcaption|pre|br|dd|dt)$/i;

/**
 * Visible text of an HTML page, one block per paragraph-like element.
 * Headings are kept so a match can name the heading above it.
 * @param {string} html
 * @returns {{ text: string, blocks: Array<{ text: string, heading: boolean, level: number, start: number }> }}
 */
export function htmlToBlocks(html) {
  const source = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ');
  /** @type {Array<{ text: string, heading: boolean, level: number, start: number }>} */
  const blocks = [];
  let current = '';
  let level = 0;
  const flush = () => {
    const value = decodeEntities(current).replace(/\s+/g, ' ').trim();
    if (value) blocks.push({ text: value, heading: level > 0, level, start: 0 });
    current = '';
    level = 0;
  };
  const tag = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  let last = 0;
  let match;
  while ((match = tag.exec(source))) {
    current += source.slice(last, match.index);
    last = tag.lastIndex;
    const name = match[1];
    if (BLOCK.test(name)) {
      flush();
      if (/^h[1-6]$/i.test(name) && !match[0].startsWith('</')) level = Number(name.slice(1));
    }
    // Inline tags (em, a, span) add nothing, as in the rendered page.
  }
  current += source.slice(last);
  flush();
  let text = '';
  for (const block of blocks) {
    if (text) text += '\n';
    block.start = text.length;
    text += block.text;
  }
  return { text, blocks };
}

/**
 * Where a match sits: the nearest heading above it, and the paragraph number under that heading.
 * Counting starts at the page title (the first h1), so site navigation above the title is not counted.
 * @param {ReturnType<typeof htmlToBlocks>} page
 * @param {number} start
 */
export function locateMatch(page, start) {
  const titleIndex = page.blocks.findIndex((block) => block.level === 1);
  let paragraph = 0;
  let heading = '';
  page.blocks.forEach((block, index) => {
    if (block.start > start) return;
    if (titleIndex >= 0 && index < titleIndex) return;
    if (block.heading) {
      heading = block.text;
      paragraph = 0;
    } else paragraph += 1;
  });
  return { paragraph, heading };
}

/**
 * Check a quote against fetched HTML. Returns the fact, the place, and a hash of the text that was checked.
 * @param {string} html
 * @param {string} quote
 */
export function checkQuoteInHtml(html, quote) {
  const meta = pageMeta(html);
  const result = checkQuoteInPage(html, quote);
  return { ...result, ...meta };
}

/**
 * Title and publication date as the page states them. Empty when the page does not say.
 * @param {string} html
 */
export function pageMeta(html) {
  const source = String(html);
  const metaContent = (/** @type {string} */ key) => {
    const tags = source.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const name = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i);
      if (!name || name[1].toLowerCase() !== key) continue;
      const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
      if (content) return decodeEntities(content[1]).replace(/\s+/g, ' ').trim();
    }
    return '';
  };
  const titleTag = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = metaContent('og:title') || (titleTag ? decodeEntities(titleTag[1]).replace(/\s+/g, ' ').trim() : '');
  const publisher = metaContent('og:site_name');
  const published = metaContent('article:published_time') || metaContent('datepublished') || metaContent('date');
  return { title: title.slice(0, 300), publisher: publisher.slice(0, 160), published: published.slice(0, 40) };
}

/**
 * @param {string} html
 * @param {string} quote
 */
function checkQuoteInPage(html, quote) {
  const page = htmlToBlocks(html);
  const match = findQuote(page.text, quote);
  const sha256 = createHash('sha256').update(page.text).digest('hex');
  if (!match.found) return { found: false, method: match.method, sha256, matched: '', paragraph: 0, heading: '', context: '' };
  const where = locateMatch(page, match.start);
  const before = page.text.lastIndexOf('\n', match.start);
  const after = page.text.indexOf('\n', match.end);
  const context = page.text.slice(before + 1, after < 0 ? page.text.length : after);
  return { found: true, method: match.method, sha256, matched: match.matched, paragraph: where.paragraph, heading: where.heading, context };
}

/**
 * A text-fragment link (#:~:text=start,end) to the live page.
 * Built from the words as they appear on the page when a match exists, so curly quotes line up.
 * @param {string} url
 * @param {string} text matched page text, or the quote when nothing matched
 */
export function textFragmentUrl(url, text) {
  const words = String(text)
    .replace(/^["'\u201c\u201d\u2018\u2019\s]+|["'\u201c\u201d\u2018\u2019\s]+$/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return url;
  const enc = (/** @type {string} */ value) =>
    encodeURIComponent(value).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
  const base = String(url).split('#')[0];
  if (words.length <= 8) return `${base}#:~:text=${enc(words.join(' '))}`;
  const start = words.slice(0, 4).join(' ');
  const end = words.slice(-4).join(' ');
  return `${base}#:~:text=${enc(start)},${enc(end)}`;
}
