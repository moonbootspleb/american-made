import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  redirects: {
    '/about': '/how-we-rate#record',
    '/manufacturers': '/',
  },
});
