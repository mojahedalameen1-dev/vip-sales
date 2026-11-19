import { cp, mkdir, rm } from 'node:fs/promises';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import pdfjs from './node_modules/pdfjs-dist/package.json' with { type: 'json' };

export default defineConfig(async () => {
  const publicDir = new URL('./.cloudflare/public/', import.meta.url);
  await mkdir(publicDir, { recursive: true });
  await cp(new URL('./assets/', import.meta.url), new URL('assets/', publicDir), {
    recursive: true,
  });
  // The generated public directory can survive previous builds.
  await Promise.all(['pdf.min.js', 'pdf.worker.min.js'].map(asset =>
    rm(new URL('assets/js/vendor/' + asset, publicDir), { force: true })
  ));
  await cp(
    new URL('./node_modules/exceljs/dist/exceljs.min.js', import.meta.url),
    new URL('assets/js/vendor/exceljs.min.js', publicDir),
  );
  const pdfSource = new URL('./node_modules/pdfjs-dist/', import.meta.url);
  const pdfPublic = new URL(`assets/js/vendor/pdfjs-${pdfjs.version}/`, publicDir);
  await mkdir(new URL('build/', pdfPublic), { recursive: true });
  await Promise.all([
    'build/pdf.min.mjs', 'build/pdf.worker.min.mjs',
    'cmaps', 'iccs', 'standard_fonts', 'wasm', 'LICENSE',
  ].map(asset => cp(new URL(asset.startsWith('build/') ? `legacy/${asset}` : asset, pdfSource), new URL(asset, pdfPublic), { recursive: true })));

  return {
    plugins: [cloudflare()],
    publicDir: '.cloudflare/public',
  };
});
