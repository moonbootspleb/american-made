import { fileURLToPath } from 'node:url';
import netlify from '@astrojs/netlify';
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
  adapter: netlify({
    imageCDN: false,
    devFeatures: {
      images: false,
      environmentVariables: false,
    },
  }),
  integrations: [supplyLinkCheck()],
  redirects: {
    '/about': '/how-we-rate#record',
    '/manufacturers': '/',
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // The shared stylesheet would otherwise take the name of an admin route.
          assetFileNames(assetInfo) {
            const source = assetInfo.names?.[0] ?? assetInfo.name ?? '';
            if (source.endsWith('.css')) return '_astro/site.[hash][extname]';
            return '_astro/[name].[hash][extname]';
          },
        },
      },
    },
  },
});
