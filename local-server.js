const http = require('http');
const fs = require('fs');
const path = require('path');
const meetingsHandler = require('./api/meetings');
const slackSyncHandler = require('./api/slack-sync');
const slackThreadHandler = require('./api/slack-thread');

const PORT = 8080;

// Mime types helper
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
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

  if (pathname === '/api/slack-sync') {
    return slackSyncHandler(req, res);
  }

  if (pathname === '/api/slack-thread') {
    return slackThreadHandler(req, res);
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, htmlContent) => {
          if (err) {
            res.writeHead(500);
            res.end('Error loading index.html');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(htmlContent, 'utf-8');
          }
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
};

const server = http.createServer(serverHandler);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
