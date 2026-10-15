import { readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { buildSupplyGraph } from './supply-graph.mjs';
import { loadSupplyLinksFromDisk } from './supply-links.mjs';

/**
 * Published manufacturers and the supply links that reach them.
 * Draft companies are dropped in buildSupplyGraph.
 * Astro bundles pages under `.netlify/`, so callers should pass the repo root
 * or rely on the process working directory, which is the repo during `astro build`.
 * @param {string} [root] repository root
 */
export function loadSupplyGraphFromDisk(root = process.cwd()) {
  const manufacturerDir = nodePath.join(root, 'src/data/manufacturers');
  const manufacturers = readdirSync(manufacturerDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(nodePath.join(manufacturerDir, name), 'utf8')));
  const { links, issues } = loadSupplyLinksFromDisk(root);
  if (issues.length > 0) {
    throw new Error(`Supply links failed validation:\n${issues.join('\n')}`);
  }
  return buildSupplyGraph({ manufacturers, links });
}
