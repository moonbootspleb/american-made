import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { domesticShareByLine, exitsUs, loadSupplyLinksFromDisk } from '../src/lib/supply-links.mjs';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');
const { links, issues } = loadSupplyLinksFromDisk(root);
if (issues.length > 0) {
  console.error(`Supply links failed validation:\n${issues.join('\n')}`);
  process.exit(1);
}
const customers = [...new Set(links.map((link) => link.customer.slug))];
console.log(`${links.length} supply links valid.`);
for (const customer of customers) {
  const share = domesticShareByLine(links, customer);
  console.log(`${customer}: ${share.domestic} of ${share.lines} input lines domestic (${share.unknown} unknown), counted by ${share.method}.`);
}
for (const link of links) {
  const exits = exitsUs(link);
  if (exits.length > 0) console.log(`Leaves the US at ${link.id}: ${exits.join('; ')}.`);
}
