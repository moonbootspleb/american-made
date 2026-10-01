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
});
