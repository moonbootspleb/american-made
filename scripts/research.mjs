import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProposalAction } from '../src/lib/proposal-actions.mjs';
import { RESEARCH_USAGE, parseResearchArgs, runResearch } from '../src/lib/research.mjs';
import { runSourceChecks } from '../src/lib/source-check.mjs';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');

const invokedDirectly = process.argv[1] && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  let parsed;
  try {
    parsed = parseResearchArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(RESEARCH_USAGE);
    process.exit(0);
  }
  if (parsed.checkSources) {
    if (parsed.act || parsed.from || parsed.dryRun || parsed.fixture || parsed.geocode) {
      console.error(`--check-sources runs alone, with an optional --id. ${RESEARCH_USAGE}`);
      process.exit(1);
    }
    runSourceChecks({ root, id: parsed.id })
      .then((rows) => {
        for (const row of rows) {
          const where = row.quoteFound ? `found (${row.method}) paragraph ${row.paragraph ?? '?'}${row.heading ? ` under "${row.heading}"` : ''}` : row.ok ? 'quote not found in source' : `fetch failed: ${row.error}`;
          console.log(`${row.id}  ${where}`);
        }
        console.log(`checked ${rows.length}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      });
  } else {
  if (parsed.act) {
    if (parsed.from || parsed.dryRun || parsed.fixture || parsed.geocode) {
      console.error(`--act does not fetch pages. ${RESEARCH_USAGE}`);
      process.exit(1);
    }
    const result = applyProposalAction({ root, id: parsed.id || '', action: parsed.act });
    console.log(result.reason);
    if (result.issues) console.error(result.issues.join('\n'));
    process.exit(result.ok ? 0 : 1);
  }
  if (!parsed.from) {
    console.error(RESEARCH_USAGE);
    process.exit(1);
  }
  if (parsed.dryRun && parsed.fixture) {
    console.error('Pass --dry-run or --fixture, not both.');
    process.exit(1);
  }
  runResearch({
    root,
    writeRoot: parsed.out ? nodePath.resolve(parsed.out) : undefined,
    from: parsed.from,
    dryRun: parsed.dryRun,
    fixture: parsed.fixture,
    geocode: parsed.geocode && !parsed.dryRun,
  })
    .then((result) => {
      if (result.dryRun) {
        for (const row of result.allowlist) console.log(`${row.url}  ${row.why}`);
        console.log('dry-run: no files written');
        return;
      }
      if (result.wrote.some((file) => file.split(nodePath.sep).includes('supply-links'))) {
        throw new Error('Research tried to write a supply link.');
      }
      console.log(`proposals ${result.proposals.length}`);
      for (const file of result.wrote) console.log(file);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
  }
}
