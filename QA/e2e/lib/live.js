/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The live dashboard of a suite run (README "Watching a run live"): keeps the run's progress.json
// (lib/progress.js) up to date, every event and every 2 s, and makes sure bin/serve-viewer.js
// serves it, at /live/ on localhost and, through `tailscale serve`, on the tailnet.

const path = require('path');
const { execFileSync, spawn } = require('child_process');
const progress = require('./progress');

const E2E = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_VIEWER_PORT || 18090);
const HEARTBEAT = 2000;

const tried = (fn) => {
  try {
    return fn();
  } catch (e) {
    return null;
  }
};

/** A run's id: its mode and when it started, in UTC, as the evidence dirs are named. */
const runId = (mode, at = new Date()) => `${mode}-${at.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`;

/** Where the tailnet reaches the server, from `tailscale serve status --json`, or null. */
function tailnetUrl(port = PORT) {
  const status = tried(() => JSON.parse(execFileSync('tailscale', ['serve', 'status', '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
  })));
  if (!status || !status.Web) return null;
  const target = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/?$`);
  const host = Object.entries(status.Web).find(([, web]) => Object.entries(web.Handlers || {})
    .some(([mount, handler]) => mount === '/' && target.test(handler.Proxy || '')));
  return host ? `https://${host[0].replace(/:443$/, '')}/live/` : null;
}

const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.status, () => 0);

/**
 * Starts bin/serve-viewer.js on its port unless it already serves the dashboard there. It is left
 * running when the suite ends, for the finished run and the past ones.
 */
async function ensureServer(log) {
  const probe = `http://127.0.0.1:${PORT}/live/runs.json`;
  let status = await answers(probe);
  if (status === 404) {
    log(`dashboard: the server on port ${PORT} is older than the dashboard; stop it and run again, or start node QA/e2e/bin/serve-viewer.js yourself`);
    return false;
  }
  if (status !== 200) {
    spawn(process.execPath, [path.join(E2E, 'bin', 'serve-viewer.js'), String(PORT)], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 20 && status !== 200; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 150); });
      // eslint-disable-next-line no-await-in-loop
      status = await answers(probe);
    }
  }
  return status === 200;
}

/** Says where to watch, in the log: on this machine, and on the tailnet when it is served there. */
function announce(id, log) {
  log(`dashboard: http://127.0.0.1:${PORT}/live/  (run ${id})`);
  const tailnet = tailnetUrl();
  if (tailnet) log(`dashboard on the tailnet: ${tailnet}`);
  else if (tried(() => execFileSync('tailscale', ['version'], { stdio: 'ignore', timeout: 3000 })) !== null) {
    log(`dashboard: to watch from another machine of the tailnet, tailscale serve --bg ${PORT}`);
  }
}

/**
 * Opens the live progress of a run, a new one or one under way (a full run's next part).
 * @returns {{ id: string, progress: object, event: (e: object) => void, close: () => void }}
 */
async function open({ id, fresh, log, why, name, }) {
  const p = progress.load(id) || fresh();
  p.run.id = id;
  if (name) p.run.name = name;
  if (why) p.messages.push(progress.message({ kind: 'why', text: why }));
  progress.save(p);
  const served = await ensureServer(log);
  if (served) announce(id, log);
  const timer = setInterval(() => tried(() => progress.save(p)), HEARTBEAT);
  timer.unref();
  return {
    id,
    progress: p,
    event(e) {
      progress.apply(p, e);
      tried(() => progress.save(p));
    },
    close() {
      clearInterval(timer);
      tried(() => progress.save(p));
    },
  };
}

module.exports = {
  PORT, runId, tailnetUrl, ensureServer, open,
};
