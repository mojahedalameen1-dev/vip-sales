import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import meetingsHandler from './api/meetings.js';
import pdfjs from './node_modules/pdfjs-dist/package.json' with { type: 'json' };

const PORT = 8080;

// Mime types helper
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const serverHandler = async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API Route
  if (pathname === '/api/meetings') {
    return meetingsHandler(req, res);
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  // Static File Serving
  const pdfPrefix = `/assets/js/vendor/pdfjs-${pdfjs.version}/`;
  const pdfAsset = pathname.startsWith(pdfPrefix);
  const pdfFile = pdfAsset ? pathname.slice(pdfPrefix.length) : '';
  const assetPath = pdfAsset ? `node_modules/pdfjs-dist/${pdfFile.startsWith('build/') ? 'legacy/' : ''}${pdfFile}`
    : pathname === '/assets/js/vendor/exceljs.min.js'
    ? 'node_modules/exceljs/dist/exceljs.min.js'
    : pathname === '/' ? 'index.html' : pathname;
  const filePath = path.join(import.meta.dirname, assetPath);
  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (pdfAsset) {
        res.writeHead(404);
        return res.end('PDF asset not found');
      }
      if (error.code === 'ENOENT') {
        fs.readFile(path.join(import.meta.dirname, 'index.html'), (err, htmlContent) => {
          if (err) {
            res.writeHead(500);
            res.end('Error loading index.html');
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(htmlContent, 'utf-8');
          }
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      const headers = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      };

      // Cache static assets like JS, CSS, Fonts, Images for 1 year
      if (pathname !== '/' && extname !== '.html') {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      } else {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      }

      res.writeHead(200, headers);
      res.end(content, 'utf-8');
    }
  });
};

const server = http.createServer(serverHandler);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
