// Minimal zero-dependency static file server for the built Vite SPA.
// Runs as the non-root user Cloud Foundry assigns (no PID file, no root needed —
// which is why this works where nginx did not). Serves ./dist with SPA fallback.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8080;
// fileURLToPath decodes the URL (e.g. %20 -> space) into a real filesystem path.
const DIST = fileURLToPath(new URL('./dist/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function sendFile(res, filePath, status = 200) {
  const body = await readFile(filePath);
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type };
  // Hashed asset filenames are safe to cache aggressively.
  if (filePath.includes('/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    // Resolve within DIST and block path traversal.
    const resolved = normalize(join(DIST, urlPath));
    if (!resolved.startsWith(DIST)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (urlPath !== '/') {
      try {
        const s = await stat(resolved);
        if (s.isFile()) {
          return await sendFile(res, resolved);
        }
      } catch {
        // fall through to SPA fallback
      }
    }
    // SPA fallback: let react-router handle client-side routes.
    return await sendFile(res, join(DIST, 'index.html'));
  } catch (err) {
    res.writeHead(500);
    res.end('Internal Server Error');
    console.error(err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Static server listening on ${PORT}`);
});
