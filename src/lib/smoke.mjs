import { readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { isPublishedManufacturer } from './publication.mjs';

/** Matches `siteName` in src/layouts/Base.astro. */
export const SITE_NAME = 'The American Forge';

export const SMOKE_USAGE = `Usage: npm run smoke -- --base-url <url>

Reads src/data/manufacturers and checks that deployed URL.
Set CHROME_PATH if Google Chrome or Chromium is not on the default path.`;

/**
 * @param {string[]} argv process.argv
 * @returns {{ baseUrl?: string, help?: boolean }}
 */
export function parseBaseUrl(argv) {
  const args = argv.slice(2);
  let baseUrl = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--base-url') {
      baseUrl = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    throw new Error(`Unknown argument ${arg}. ${SMOKE_USAGE}`);
  }
  if (!baseUrl) throw new Error(`Pass --base-url. ${SMOKE_USAGE}`);

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Not a URL: ${baseUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must be http or https.');
  }
  parsed.hash = '';
  parsed.search = '';
  const href = parsed.href.endsWith('/') ? parsed.href.slice(0, -1) : parsed.href;
  return { baseUrl: href };
}

/**
 * @param {string} directory
 */
export function loadManufacturers(directory) {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const profiles = files.map((name) => {
    let profile;
    try {
      profile = JSON.parse(readFileSync(nodePath.join(directory, name), 'utf8'));
    } catch (error) {
      throw new Error(`Could not read ${name}: ${error instanceof Error ? error.message : error}`);
    }
    if (!profile || typeof profile.name !== 'string' || typeof profile.slug !== 'string') {
      throw new Error(`${name} needs a name and a slug.`);
    }
    return profile;
  });
  const published = profiles.filter((profile) => isPublishedManufacturer(profile));
  const unpublished = profiles.filter((profile) => !isPublishedManufacturer(profile));
  return { published, unpublished };
}

/**
 * Names and the slug that must not show up on a public page for this file.
 * @param {{ name?: unknown, legalName?: unknown, slug?: unknown }} profile
 */
export function leakNeedles(profile) {
  const values = [profile?.name, profile?.legalName, profile?.slug];
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

/**
 * @param {string} html
 * @param {string} needle
 */
export function pageMentions(html, needle) {
  const haystack = String(html).toLowerCase();
  const value = needle.toLowerCase();
  if (haystack.includes(value)) return true;
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return haystack.includes(escaped);
}

/**
 * @param {string} html
 * @returns {Record<string, unknown> | null}
 */
export function graphFromHtml(html) {
  const match = String(html).match(/<script[^>]*id="supply-graph-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const graph = JSON.parse(match[1]);
    if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return null;
    }
    return graph;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {string} needle
 */
export function valueMentions(value, needle) {
  const target = needle.toLowerCase();
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (current.toLowerCase().includes(target)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current && typeof current === 'object') stack.push(...Object.values(current));
  }
  return false;
}

/**
 * @param {string} html
 * @param {unknown} graph
 * @param {{ name?: unknown, legalName?: unknown, slug?: unknown }} profile
 */
export function leakedNeedles(html, graph, profile) {
  return leakNeedles(profile).filter(
    (needle) => pageMentions(html, needle) || (graph ? valueMentions(graph, needle) : false),
  );
}

/**
 * One circle marker per sourced location on the graph embedded in the page.
 * @param {{ nodes?: { locations?: unknown[] }[] } | null | undefined} graph
 */
export function pinCount(graph) {
  return (graph?.nodes ?? []).reduce((sum, node) => {
    const locations = node?.locations;
    return sum + (Array.isArray(locations) ? locations.length : 0);
  }, 0);
}

/** Leaflet circle markers use an arc command. Polylines do not. */
export function isCircleMarkerPath(d) {
  return typeof d === 'string' && /[Aa]/.test(d);
}

/**
 * @param {number} status
 * @param {string | null | undefined} location
 */
export function isLoginRedirect(status, location) {
  if (![301, 302, 303, 307, 308].includes(status)) return false;
  if (!location) return false;
  try {
    const url = new URL(location, 'https://smoke.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return path === '/admin/login';
  } catch {
    return false;
  }
}

/**
 * @param {{ name: string, pass: boolean, detail: string }[]} results
 */
export function formatReport(results) {
  const nameWidth = Math.max('Check'.length, ...results.map((result) => result.name.length));
  const header = `${'Check'.padEnd(nameWidth)}  Result  Detail`;
  const rule = '-'.repeat(Math.min(100, header.length));
  const lines = results.map((result) => {
    const label = result.pass ? 'PASS' : 'FAIL';
    const detail = String(result.detail ?? '').replace(/\s+/g, ' ').trim();
    return `${result.name.padEnd(nameWidth)}  ${label.padEnd(6)}  ${detail}`;
  });
  const failed = results.filter((result) => !result.pass).length;
  return [header, rule, ...lines, '', `${results.length - failed}/${results.length} passed`].join('\n');
}

/**
 * @param {string[]} candidates
 * @param {(path: string) => boolean} exists
 */
export function findChrome(candidates, exists) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function chromeCandidates(env = process.env) {
  return [
    env.CHROME_PATH,
    env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((value) => typeof value === 'string' && value.length > 0);
}
