import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { loadSupplyLinksFromDisk } from './src/lib/supply-links.mjs';

/** Fail the build when a supply link breaks the rules in src/lib/supply-links.mjs. */
function supplyLinkCheck() {
  return {
    name: 'supply-link-check',
    hooks: {
      'astro:config:setup': () => {
        const root = fileURLToPath(new URL('.', import.meta.url));
        const { issues } = loadSupplyLinksFromDisk(root);
        if (issues.length > 0) {
          throw new Error(`Supply links failed validation:\n${issues.join('\n')}`);
        }
      },
    },
  };
}

export default defineConfig({
  output: 'static',
  integrations: [supplyLinkCheck()],
  redirects: {
    '/about': '/how-we-rate#record',
    '/manufacturers': '/',
  },
});
