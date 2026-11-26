#!/usr/bin/env node
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Serves the runs' viewers (QA/e2e/evidence) and the live dashboard of suite runs (/live/) on
// localhost, to watch them from another machine through `tailscale serve`:
//
//   node QA/e2e/bin/serve-viewer.js [port]          (default 18090)
//   tailscale serve --bg <port>                       https://<this machine>.<tailnet>.ts.net/
//
// Only the viewers, the runs' index and the recordings are served: an evidence dir also holds
// the run's seeds and Maestro's logs. Onboarding isn't recorded, as its screen shows the seed, and
// an onboard/ recording from an older run isn't served. Recordings are served in byte ranges,
// which Safari needs to play a video at all and every browser needs to seek one.
//
// /live/ is dashboard/dashboard.html; it reads /live/runs.json (the suite runs, newest first) and
// /live/<run>/progress.json, which suite.js keeps up to date (lib/progress.js). suite.js starts
// this server when nothing answers on its port, and leaves it running.

const fs = require('fs');
const http = require('http');
const path = require('path');

const EVIDENCE = path.resolve(__dirname, '..', 'evidence');
const LIVE = path.join(EVIDENCE, 'live');
const DASHBOARD = path.resolve(__dirname, '..', 'dashboard', 'dashboard.html');
const PORT = Number(process.argv[2] || 18090);
const ALLOWED = /^\/(index\.html|[\w-]+\/viewer\.html|[\w-]+\/(?!onboard\/)([\w-]+\/)*screen\.mp4)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.json': 'application/json' };

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
};

/** The suite runs the dashboard can show, newest first. */
function runs() {
  if (!fs.existsSync(LIVE)) return [];
  const ids = fs.readdirSync(LIVE).filter((id) => /^[\w-]+$/.test(id)).sort().reverse();
  return ids.map((id) => {
    const p = readJson(path.join(LIVE, id, 'progress.json'));
    if (!p || !p.run) return null;
    const { mode, name, state, startedAt, commit } = p.run;
    return {
      id, mode, name, state, startedAt, commit,
    };
  })
    .filter(Boolean);
}

/** A run's progress, with the messages said to it while no suite ran it. */
function progressOf(id) {
  const p = readJson(path.join(LIVE, id, 'progress.json'));
  if (!p) return null;
  const inbox = path.join(LIVE, id, 'messages.ndjson');
  if (fs.existsSync(inbox)) {
    const seen = new Set((p.messages || []).map((m) => `${m.at} ${m.text}`));
    fs.readFileSync(inbox, 'utf8').split('\n').filter(Boolean).forEach((line) => {
      const m = (() => { try { return JSON.parse(line); } catch (e) { return null; } })();
      if (m && !seen.has(`${m.at} ${m.text}`)) p.messages = [...(p.messages || []), m];
    });
  }
  return p;
}

function live(name, res) {
  const json = (body) => res.writeHead(body ? 200 : 404, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
    .end(body ? JSON.stringify(body) : '{}');
  // The page reads its data by relative paths, so it lives under /live/.
  if (name === '/live') return res.writeHead(301, { Location: '/live/' }).end();
  if (name === '/live/' || name === '/live/index.html') {
    if (!fs.existsSync(DASHBOARD)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    return fs.createReadStream(DASHBOARD).pipe(res);
  }
  if (name === '/live/runs.json') return json(runs());
  const run = /^\/live\/([\w-]+)\/progress\.json$/.exec(name);
  if (run) return json(progressOf(run[1]));
  return res.writeHead(404).end('not found');
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (url === '/live' || url.startsWith('/live/')) {
    live(url, res);
    return;
  }
  const name = url === '/' ? '/index.html' : url;
  const file = path.join(EVIDENCE, name);
  if (!ALLOWED.test(name) || !file.startsWith(`${EVIDENCE}${path.sep}`) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const { size } = fs.statSync(file);
  const headers = { 'Content-Type': TYPES[path.extname(file)], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    // "bytes=-N" is the last N bytes.
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serve-viewer: ${EVIDENCE} on http://127.0.0.1:${PORT}/`);
});
