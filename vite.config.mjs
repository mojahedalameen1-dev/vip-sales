import { cp, mkdir } from 'node:fs/promises';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig(async () => {
  const publicDir = new URL('./.cloudflare/public/', import.meta.url);
  await mkdir(publicDir, { recursive: true });
  await cp(new URL('./assets/', import.meta.url), new URL('assets/', publicDir), {
    recursive: true,
  });
  await cp(
    new URL('./node_modules/exceljs/dist/exceljs.min.js', import.meta.url),
    new URL('assets/js/vendor/exceljs.min.js', publicDir),
  );

  return {
    plugins: [cloudflare()],
    publicDir: '.cloudflare/public',
  };
});
