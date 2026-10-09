import netlify from '@astrojs/netlify';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  adapter: netlify({
    imageCDN: false,
    devFeatures: {
      images: false,
      environmentVariables: false,
    },
  }),
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
