import { existsSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  SITE_NAME,
  SMOKE_USAGE,
  chromeCandidates,
  findChrome,
  fillsViewport,
  formatReport,
  graphFromHtml,
  isLoginRedirect,
  leakedNeedles,
  loadManufacturers,
  pageMentions,
  parseBaseUrl,
  pinCount,
} from '../src/lib/smoke.mjs';
import { loadSupplyGraphFromDisk } from '../src/lib/load-supply-graph.mjs';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} url
 * @param {{ redirect?: RequestRedirect }} [options]
 */
async function request(url, options = {}) {
  const response = await fetch(url, {
    redirect: options.redirect ?? 'follow',
    signal: AbortSignal.timeout(20000),
    headers: { accept: 'text/html,application/json' },
  });
  const text = await response.text();
  return {
    status: response.status,
    location: response.headers.get('location'),
    text,
  };
}

/**
 * @param {string} name
 * @param {string[]} problems
 * @param {string} okDetail
 */
function result(name, problems, okDetail) {
  const issues = problems.filter(Boolean);
  return {
    name,
    pass: issues.length === 0,
    detail: issues.length > 0 ? issues.join('; ') : okDetail,
  };
}

/**
 * @param {string} html
 */
function titleOf(html) {
  return html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
}

/**
 * @param {boolean} webgl
 */
function browserArgs(webgl) {
  const shared = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (webgl) {
    return [...shared, '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'];
  }
  return [...shared, '--disable-webgl', '--disable-3d-apis'];
}

/**
 * @param {string} chromePath
 * @param {boolean} webgl
 * @param {(page: import('puppeteer-core').Page) => Promise<void>} run
 */
async function withPage(chromePath, webgl, run) {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: browserArgs(webgl),
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.setViewport({ width: 1280, height: 900 });
    await run(page);
  } finally {
    await browser.close();
  }
}

/**
 * @param {import('puppeteer-core').Page} page
 */
function watchPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  return errors;
}

/**
 * @param {string} baseUrl
 * @param {string} chromePath
 * @param {{ status: number, text: string }} mapPage
 */
async function checkMap(baseUrl, chromePath, mapPage) {
  const name = 'Supply chain map';
  if (mapPage.status !== 200) return result(name, [`HTTP ${mapPage.status}`], '');
  const graph = graphFromHtml(mapPage.text);
  if (!graph) return result(name, ['page has no supply graph JSON'], '');
  const expectedPins = pinCount(graph);
  /** @type {string[]} */
  const problems = [];
  try {
    await withPage(chromePath, true, async (page) => {
      const errors = watchPageErrors(page);
      const failedTiles = [];
      page.on('requestfailed', (request) => {
        if (request.url().includes('tile.openstreetmap.org')) failedTiles.push(request.url());
      });
      const response = await page.goto(`${baseUrl}/supply-chain/map/`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      if (response && response.status() !== 200) problems.push(`browser HTTP ${response.status()}`);
      await page.waitForSelector('.leaflet-container', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 0, {
        timeout: 15000,
      });
      const state = await page.evaluate((circleTest) => {
        const paths = [...document.querySelectorAll('#supply-map path')];
        const pins = paths.filter((path) => new RegExp(circleTest).test(path.getAttribute('d') || '')).length;
        const button = document.querySelector('[data-select-node]');
        const buttonName = button?.textContent?.trim() || '';
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return {
          tiles: document.querySelectorAll('.leaflet-tile-loaded').length,
          pins,
          attribution: document.querySelector('.leaflet-control-attribution')?.textContent || '',
          buttonName,
          panel: document.querySelector('#supply-detail')?.textContent || '',
          box: (() => {
            const rect = document.querySelector('#supply-map')?.getBoundingClientRect();
            return rect ? { width: rect.width, height: rect.height } : null;
          })(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      }, '[Aa]');
      const filePins = pinCount(loadSupplyGraphFromDisk(root));
      if (state.tiles < 1) problems.push('no OpenStreetMap tiles loaded');
      if (failedTiles.length > 0 && state.tiles < 1) problems.push('OpenStreetMap tile requests failed');
      if (!/openstreetmap/i.test(state.attribution)) problems.push('map attribution is missing');
      if (state.pins !== expectedPins) {
        problems.push(`pins ${state.pins}, sourced locations ${expectedPins}`);
      }
      if (filePins > 0 && state.pins < 1) problems.push('files have sourced coordinates but the map has no pin');
      if (filePins !== expectedPins) {
        problems.push(`page lists ${expectedPins} sourced locations, files list ${filePins}`);
      }
      if (!fillsViewport(state.box, state.viewport)) {
        problems.push(
          `map ${Math.round(state.box?.width || 0)}x${Math.round(state.box?.height || 0)} in a ${state.viewport.width}x${state.viewport.height} viewport`,
        );
      }
      if (!state.buttonName) {
        if (expectedPins < 1) problems.push('no company button and no pins');
      } else if (!state.panel.includes(state.buttonName)) {
        problems.push(`panel did not show ${state.buttonName}`);
      }
      if (errors.length > 0) problems.push(errors.join(' | '));
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const shown = graph.nodes.find((node) => node.kind === 'manufacturer')?.name || `${graph.nodes.length} companies`;
  return result(
    name,
    problems,
    `200, ${stateDetail(graph)}, ${expectedPins} pins, panel ${shown}`,
  );
}

/**
 * @param {{ nodes: unknown[], edges: unknown[] }} graph
 */
function stateDetail(graph) {
  return `${graph.nodes.length} companies, ${graph.edges.length} links`;
}

/**
 * @param {string} baseUrl
 * @param {string} chromePath
 * @param {{ status: number, text: string }} explorePage
 */
async function checkExplore(baseUrl, chromePath, explorePage) {
  const name = 'Supply chain explore (WebGL)';
  if (explorePage.status !== 200) return result(name, [`HTTP ${explorePage.status}`], '');
  const graph = graphFromHtml(explorePage.text);
  if (!graph) return result(name, ['page has no supply graph JSON'], '');
  const manufacturer = graph.nodes.find((node) => node.kind === 'manufacturer');
  /** @type {string[]} */
  const problems = [];
  try {
    await withPage(chromePath, true, async (page) => {
      const errors = watchPageErrors(page);
      const response = await page.goto(`${baseUrl}/supply-chain/explore/`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      if (response && response.status() !== 200) problems.push(`browser HTTP ${response.status()}`);
      await page.waitForSelector('#supply-stage canvas', { timeout: 20000 });
      const state = await page.evaluate((nodeId) => {
        const stage = document.querySelector('#supply-stage');
        const canvas = stage?.querySelector('canvas');
        const note = document.querySelector('#supply-webgl-note');
        const button = nodeId ? document.querySelector(`[data-select-node="${nodeId}"]`) : null;
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const visible = (selector) => [...document.querySelectorAll(selector)].filter((item) => !item.hidden).length;
        return {
          stageHidden: stage?.hidden ?? null,
          noteHidden: note?.hidden ?? null,
          canvasWidth: canvas?.width ?? 0,
          companies: visible('[data-supply-node]'),
          links: visible('[data-supply-edge]'),
          panel: document.querySelector('#supply-detail')?.textContent || '',
          box: stage
            ? { width: stage.getBoundingClientRect().width, height: stage.getBoundingClientRect().height }
            : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      }, manufacturer?.id ?? '');
      if (state.stageHidden !== false || state.canvasWidth < 1) problems.push('3D view did not draw');
      if (!fillsViewport(state.box, state.viewport)) {
        problems.push(
          `graph ${Math.round(state.box?.width || 0)}x${Math.round(state.box?.height || 0)} in a ${state.viewport.width}x${state.viewport.height} viewport`,
        );
      }
      if (state.noteHidden !== true) problems.push('no-WebGL note was showing');
      if (state.companies !== graph.nodes.length || state.links !== graph.edges.length) {
        problems.push(`list ${state.companies} companies and ${state.links} links, graph ${stateDetail(graph)}`);
      }
      if (manufacturer && !state.panel.includes(manufacturer.name)) {
        problems.push(`panel did not show ${manufacturer.name}`);
      }
      if (errors.length > 0) problems.push(errors.join(' | '));
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return result(name, problems, `200, canvas, ${stateDetail(graph)}`);
}

/**
 * @param {string} baseUrl
 * @param {string} chromePath
 * @param {{ status: number, text: string }} explorePage
 */
async function checkExploreFallback(baseUrl, chromePath, explorePage) {
  const name = 'Supply chain explore (no WebGL)';
  if (explorePage.status !== 200) return result(name, [`HTTP ${explorePage.status}`], '');
  const graph = graphFromHtml(explorePage.text);
  if (!graph) return result(name, ['page has no supply graph JSON'], '');
  /** @type {string[]} */
  const problems = [];
  try {
    await withPage(chromePath, false, async (page) => {
      const errors = watchPageErrors(page);
      await page.goto(`${baseUrl}/supply-chain/explore/`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => {
        const note = document.querySelector('#supply-webgl-note');
        return Boolean(note && note.hidden === false);
      }, { timeout: 10000 });
      const state = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const webgl = Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        const stage = document.querySelector('#supply-stage');
        const note = document.querySelector('#supply-webgl-note');
        const visible = (selector) => [...document.querySelectorAll(selector)].filter((item) => !item.hidden).length;
        return {
          webgl,
          stageHidden: stage?.hidden ?? null,
          note: note?.textContent?.trim() || '',
          companies: visible('[data-supply-node]'),
          links: visible('[data-supply-edge]'),
        };
      });
      if (state.webgl) problems.push('WebGL was still available');
      if (state.stageHidden !== true) problems.push('3D stage stayed visible');
      if (!/cannot draw the 3D view/i.test(state.note)) problems.push(`note: ${state.note || 'empty'}`);
      if (state.companies !== graph.nodes.length || state.links !== graph.edges.length) {
        problems.push(`list ${state.companies} companies and ${state.links} links, graph ${stateDetail(graph)}`);
      }
      if (errors.length > 0) problems.push(errors.join(' | '));
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return result(name, problems, `list kept, ${stateDetail(graph)}`);
}

/**
 * @param {string} baseUrl
 */
async function runSmoke(baseUrl) {
  const dataDir = nodePath.join(root, 'src/data/manufacturers');
  const { published, unpublished } = loadManufacturers(dataDir);
  const chromePath = findChrome(chromeCandidates(), existsSync);
  const home = await request(`${baseUrl}/`);
  const mapPage = await request(`${baseUrl}/supply-chain/map/`);
  const explorePage = await request(`${baseUrl}/supply-chain/explore/`);

  const homeProblems = [];
  if (home.status !== 200) homeProblems.push(`HTTP ${home.status}`);
  if (!titleOf(home.text).includes(SITE_NAME)) homeProblems.push(`title "${titleOf(home.text) || 'missing'}"`);
  if (!home.text.includes('href="/supply-chain/map"') && !home.text.includes("href='/supply-chain/map'")) {
    homeProblems.push('no link to /supply-chain/map');
  }
  for (const profile of published) {
    if (!pageIncludesName(home.text, profile.name)) homeProblems.push(`home omits ${profile.name}`);
    if (!home.text.includes(`/manufacturers/${profile.slug}`)) {
      homeProblems.push(`home omits /manufacturers/${profile.slug}`);
    }
  }
  if (published.length === 0) homeProblems.push('no published manufacturer files');

  const profileProblems = [];
  for (const profile of published) {
    const page = await request(`${baseUrl}/manufacturers/${profile.slug}/`);
    if (page.status !== 200) profileProblems.push(`${profile.slug} HTTP ${page.status}`);
    else if (!pageIncludesName(page.text, profile.name)) profileProblems.push(`${profile.slug} omits its name`);
  }
  if (published.length === 0) profileProblems.push('no published manufacturer files');

  const draftProblems = [];
  const pages = [
    ['home', home.text, null],
    ['map', mapPage.text, graphFromHtml(mapPage.text)],
    ['explore', explorePage.text, graphFromHtml(explorePage.text)],
  ];
  if (mapPage.status === 200 && !pages[1][2]) draftProblems.push('map graph JSON missing');
  if (explorePage.status === 200 && !pages[2][2]) draftProblems.push('explore graph JSON missing');
  for (const profile of unpublished) {
    for (const [label, html, graph] of pages) {
      const leaked = leakedNeedles(html, graph, profile);
      if (leaked.length > 0) draftProblems.push(`${profile.slug} on ${label} (${leaked.join(', ')})`);
    }
    const page = await request(`${baseUrl}/manufacturers/${profile.slug}/`);
    if (page.status !== 404) draftProblems.push(`${profile.slug} profile HTTP ${page.status}`);
  }

  const queue = await request(`${baseUrl}/admin/queue`, { redirect: 'manual' });
  const drafts = await request(`${baseUrl}/admin/drafts`, { redirect: 'manual' });
  const adminProblems = [];
  if (!isLoginRedirect(queue.status, queue.location)) {
    adminProblems.push(`/admin/queue HTTP ${queue.status} location ${queue.location || 'none'}`);
  }
  if (!isLoginRedirect(drafts.status, drafts.location)) {
    adminProblems.push(`/admin/drafts HTTP ${drafts.status} location ${drafts.location || 'none'}`);
  }

  const api = await request(`${baseUrl}/api/admin/submissions`, { redirect: 'manual' });
  const apiProblems = api.status === 401 ? [] : [`HTTP ${api.status}`];

  /** @type {{ name: string, pass: boolean, detail: string }[]} */
  const browserSkipped = (checkName) =>
    result(checkName, [chromePath ? 'not run' : 'Chrome not found. Set CHROME_PATH.'], '');

  const mapCheck = chromePath ? await checkMap(baseUrl, chromePath, mapPage) : browserSkipped('Supply chain map');
  const exploreCheck = chromePath
    ? await checkExplore(baseUrl, chromePath, explorePage)
    : browserSkipped('Supply chain explore (WebGL)');
  const fallbackCheck = chromePath
    ? await checkExploreFallback(baseUrl, chromePath, explorePage)
    : browserSkipped('Supply chain explore (no WebGL)');

  const results = [
    result('Home', homeProblems, `200, ${published.map((profile) => profile.name).join(', ')}`),
    result(
      'Company profile',
      profileProblems,
      published.map((profile) => `${profile.name} 200`).join(', '),
    ),
    mapCheck,
    exploreCheck,
    fallbackCheck,
    result('Admin queue and drafts', adminProblems, '302 to /admin/login'),
    result('Admin submissions API', apiProblems, '401'),
    result(
      'Draft companies',
      draftProblems,
      unpublished.length === 0
        ? 'no unpublished manufacturer files'
        : unpublished.map((profile) => `${profile.slug} absent, profile 404`).join('; '),
    ),
  ];
  console.log(formatReport(results));
  return results.some((item) => !item.pass) ? 1 : 0;
}

/**
 * @param {string} html
 * @param {string} name
 */
function pageIncludesName(html, name) {
  return pageMentions(html, name);
}

const invokedDirectly =
  process.argv[1] && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  let parsed;
  try {
    parsed = parseBaseUrl(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(SMOKE_USAGE);
    process.exit(0);
  }
  runSmoke(parsed.baseUrl)
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : error);
      process.exit(1);
    });
}
