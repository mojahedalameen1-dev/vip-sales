import { cp, mkdir } from 'node:fs/promises';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig(async () => {
  const publicDir = new URL('./.cloudflare/public/', import.meta.url);
  await mkdir(publicDir, { recursive: true });
  await cp(new URL('./assets/', import.meta.url), new URL('assets/', publicDir), {
    recursive: true,
  });

  return {
    plugins: [cloudflare()],
    publicDir: '.cloudflare/public',
  };
});
