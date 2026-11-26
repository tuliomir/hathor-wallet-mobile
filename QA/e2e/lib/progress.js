/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// What a suite run is doing, as the live dashboard reads it: evidence/live/<run>/progress.json,
// rewritten on every event and every 2 s. The schema is the one of design/sample-progress.json,
// with the fields listed in README "Watching a run live". run.js reports to it over IPC when
// suite.js starts it; run alone, it reports nothing.

// apply() changes the progress it is given, in place: it is the one copy the suite keeps.
/* eslint-disable no-param-reassign */

const fs = require('fs');
const path = require('path');

const LIVE = path.join(__dirname, '..', 'evidence', 'live');
const SCHEMA = 1;
// The log keeps this many events, newest first.
const EVENTS = 600;
// No event for this many times the longest usual gap is "stuck"; the page and the runner agree.
const STUCK_FACTOR = 3;
// The longest gap between events that counts as usual before any was measured: a wallet's setup
// (lib/app.js) is the longest step without an event.
const USUAL_GAP = 240;
const WALLETS = ['unlocked', 'locked', 'broken-key'];

const TAGS = {
  new: 'Never ran here',
  changed: 'Its own test, or its feature, changed',
  failed: 'Failed the last time it ran',
  owed: 'Something shared changed that may reach it',
  fresh: 'Last passed with exactly what is here',
  'stale app': 'Its last result was on an app not built from these sources',
  skipped: 'The kit can\'t run it yet',
};

// A base58 address (34 characters and more) shows as its ends only: the dashboard never shows a
// full one, nor the seed or the PIN, which nothing here reports.
const ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{34,}\b/g;
const redact = (text) => (text == null ? text : String(text).replace(ADDRESS, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`));

const iso = (ms = Date.now()) => new Date(ms).toISOString();

/**
 * A new run's progress, every scenario queued.
 * @param {object} run the `run` block: id, mode, name, commit, branch, tree, app, device, selection
 * @param {{ job: object, rows: object[] }[]} jobs the jobs in order, each with its rows as
 *   suite.js plans them (`scenario`, `outcome`, `standing`, `seconds`, `measured`)
 * @param {{ setupSeconds: object, extraSeconds?: Function }} estimates a wallet's setup by
 *   state, and what a group's setup takes on top (the tokens the app creates)
 */
function newProgress(run, jobs, { setupSeconds, extraSeconds = () => 0 }) {
  const now = iso();
  return {
    schema: SCHEMA,
    run: {
      state: 'starting',
      startedAt: now,
      now,
      stuckAfterSeconds: STUCK_FACTOR * USUAL_GAP,
      ...run,
    },
    current: { phase: 'build', startedAt: now, lastEventAt: now },
    tags: TAGS,
    messages: [],
    jobs: jobs.map(({ job, rows }) => {
      const groups = WALLETS
        .map((wallet) => ({ wallet, rows: rows.filter((row) => row.scenario.values['private-balance'] === wallet) }))
        .filter((group) => group.rows.length)
        .map((group) => ({
          wallet: group.wallet,
          setupEstimateSeconds: setupSeconds[group.wallet] + extraSeconds(job, group.rows),
          scenarios: group.rows.length,
        }));
      const scenarios = groups.flatMap((group) => rows
        .filter((row) => row.scenario.values['private-balance'] === group.wallet)
        .map((row) => ({
          id: row.scenario.id,
          title: row.scenario.id.split(':').pop(),
          wallet: group.wallet,
          expects: row.outcome && row.outcome.id,
          expectsText: row.outcome && redact(row.outcome.message),
          tag: row.standing.state,
          why: row.standing.why,
          status: 'queued',
          estimateSeconds: row.seconds,
          estimateFrom: row.measured ? 'last run' : 'guess',
        })));
      const estimateSeconds = scenarios.reduce((sum, s) => sum + s.estimateSeconds, 0)
        + groups.reduce((sum, g) => sum + g.setupEstimateSeconds, 0);
      const guessed = scenarios.filter((s) => s.estimateFrom === 'guess').length;
      return {
        id: job.id,
        facade: job.setup.startsWith('pn-ws') ? 'wallet-service' : 'fullnode',
        action: job.action,
        status: 'queued',
        tries: 0,
        estimateSeconds,
        estimateFrom: { 0: 'last run', [scenarios.length]: 'guess' }[guessed] || 'mixed',
        guessed,
        groups,
        scenarios,
      };
    }),
    events: [],
  };
}

/** The longest gap between two events so far, which sets when the run counts as stuck. */
function longestGap(events) {
  let longest = 0;
  for (let i = 1; i < events.length; i += 1) {
    const gap = (Date.parse(events[i - 1].at) - Date.parse(events[i].at)) / 1000;
    const paused = events[i - 1].type === 'part-started' || events[i - 1].type === 'message';
    if (!paused && gap > longest) longest = gap;
  }
  return longest;
}

function endPart(p, at) {
  const last = (p.run.parts || [])[(p.run.parts || []).length - 1];
  if (last && !last.endedAt) last.endedAt = at;
}

const jobOf = (p, id) => p.jobs.find((job) => job.id === id);
const scenarioOf = (job, id) => job && job.scenarios.find((s) => s.id === id);
const groupOf = (job, wallet) => job && job.groups.find((g) => g.wallet === wallet);

const LOGGED = {
  'job-started': (e) => `${e.job} started${e.tries > 1 ? ` (try ${e.tries})` : ''}`,
  'job-finished': (e) => (e.counts
    ? `${e.job}: ${e.counts.passed} passed, ${e.counts.failed} failed, ${e.counts.skipped} skipped`
    : `${e.job} did not finish`),
  'setup-started': (e) => `setting up the ${e.wallet} wallet for ${e.count} scenarios`,
  'setup-finished': (e) => {
    if (e.error) return `the ${e.wallet} wallet's setup broke: ${e.error}`;
    return e.reused ? `went on with the ${e.wallet} wallet the app held` : `the ${e.wallet} wallet is set up`;
  },
  'scenario-started': (e) => `${e.title} started`,
  'scenario-finished': (e) => `${e.title}: ${e.status}${e.note ? ` · ${e.note}` : ''}`,
  'scenario-not-run': (e) => `${e.title}: ${e.status} · ${e.note}`,
  phase: (e) => e.text,
  'part-started': (e) => `part ${e.n} started`,
  'part-ended': (e) => e.text,
  'run-finished': (e) => e.text,
  message: (e) => `${e.kind}: ${e.text}`,
};

/**
 * Applies one event to the progress. Events come from suite.js (job-*, phase, part-*, run-*) and
 * from run.js (setup-*, scenario-*, step).
 */
function apply(p, event) {
  const e = { at: iso(), ...event };
  ['text', 'note', 'error'].forEach((key) => { if (e[key] != null) e[key] = redact(e[key]); });
  const job = jobOf(p, e.job || (p.current && p.current.job));
  const { current } = p;
  if (e.type !== 'step' && e.type !== 'message') current.lastEventAt = e.at;
  switch (e.type) {
    case 'phase':
      Object.assign(current, {
        phase: e.phase,
        startedAt: e.at,
        step: { text: e.text },
        expectedSeconds: e.expectedSeconds || null,
      });
      if (e.quietSeconds) current.quietUntil = iso(Date.parse(e.at) + e.quietSeconds * 1000);
      else delete current.quietUntil;
      break;
    case 'part-started':
      p.run.part = {
        n: e.n, startedAt: e.at, endsBy: e.endsBy || null, minutes: e.minutes || null,
      };
      // Every part's span: the time between parts is not work, and elapsed leaves it out.
      p.run.parts = [
        ...(p.run.parts || []).filter((part) => part.n !== e.n), { n: e.n, startedAt: e.at },
      ];
      p.run.state = 'running';
      delete p.run.finishedAt;
      break;
    case 'part-ended':
      Object.assign(p.run.part || {}, { endedAt: e.at });
      endPart(p, e.at);
      p.run.state = 'paused';
      p.run.resume = e.resume;
      Object.assign(current, { phase: 'paused', startedAt: e.at, step: null, job: null, scenario: null });
      break;
    case 'job-started':
      Object.assign(job, { status: 'running', started: e.at, tries: e.tries || job.tries + 1 });
      delete job.finished;
      if (e.tries > 1) {
        // A second try runs every scenario of the job again.
        job.scenarios.forEach((s) => {
          if (s.status === 'passed' || s.status === 'failed' || s.status === 'did not run') {
            s.firstTry = { status: s.status, note: s.note };
          }
          Object.assign(s, { status: 'queued' });
          ['started', 'finished', 'note', 'viewer'].forEach((key) => delete s[key]);
        });
        job.groups.forEach((g) => { ['setupStarted', 'setupFinished', 'setupError', 'reused'].forEach((key) => delete g[key]); });
      }
      p.run.state = 'running';
      Object.assign(current, {
        job: job.id, phase: 'setup', scenario: null, wallet: null, startedAt: e.at, step: null, expectedSeconds: null,
      });
      delete current.quietUntil;
      break;
    case 'job-finished':
      Object.assign(job, { finished: e.at, counts: e.counts || null, status: e.counts ? 'done' : 'did not finish' });
      if (e.viewer) job.viewer = e.viewer;
      job.scenarios.filter((s) => s.status === 'running').forEach((s) => { s.status = 'failed'; s.note = 'the job stopped during it'; });
      Object.assign(current, { phase: 'cleanup', scenario: null, step: null, startedAt: e.at });
      break;
    case 'setup-started': {
      const group = groupOf(job, e.wallet);
      if (group) Object.assign(group, { setupStarted: e.at, reused: Boolean(e.reused) });
      e.count = group ? group.scenarios : 0;
      Object.assign(current, { phase: 'setup', wallet: e.wallet, scenario: null, startedAt: e.at, step: null });
      break;
    }
    case 'setup-finished': {
      const group = groupOf(job, e.wallet);
      if (group) {
        Object.assign(group, { setupFinished: e.at, reused: Boolean(e.reused) });
        if (e.error) group.setupError = e.error;
      }
      break;
    }
    case 'viewer':
      if (job) job.viewer = e.viewer;
      break;
    case 'scenario-started': {
      const s = scenarioOf(job, e.scenario);
      if (s) Object.assign(s, { status: 'running', started: e.at });
      e.title = s ? s.title : e.scenario;
      Object.assign(current, {
        phase: 'scenario', scenario: e.scenario, wallet: s ? s.wallet : current.wallet, startedAt: e.at, step: null,
      });
      break;
    }
    case 'step':
      current.step = { text: e.text, startedAt: e.at };
      break;
    case 'scenario-finished':
    case 'scenario-not-run': {
      const s = scenarioOf(job, e.scenario);
      if (s) {
        Object.assign(s, { status: e.status, finished: e.at, note: e.note });
        if (e.type === 'scenario-not-run') delete s.started;
        if (e.viewer) s.viewer = e.viewer;
      }
      e.title = s ? s.title : e.scenario;
      if (e.type === 'scenario-finished') Object.assign(current, { phase: 'setup', scenario: null, step: null });
      break;
    }
    case 'run-finished':
      Object.assign(p.run, { state: e.state || 'finished', finishedAt: e.at });
      endPart(p, e.at);
      // What to run next, if anything: a resume, or a retry of the failed jobs.
      if (e.resume) p.run.resume = e.resume;
      else delete p.run.resume;
      Object.assign(current, { phase: e.state === 'stopped' ? 'stopped' : 'done', job: null, scenario: null, step: null, startedAt: e.at });
      break;
    default:
      break;
  }
  if (LOGGED[e.type]) {
    const logged = {
      at: e.at, type: e.type, job: e.job, scenario: e.scenario, text: LOGGED[e.type](e),
    };
    if (e.status) logged.status = e.status;
    // Newest first; a message said while no suite ran may be older than the last event.
    const at = p.events.findIndex((other) => other.at <= logged.at);
    p.events.splice(at < 0 ? p.events.length : at, 0, logged);
    p.events.length = Math.min(p.events.length, EVENTS);
  }
  const gap = longestGap(p.events);
  p.run.stuckAfterSeconds = STUCK_FACTOR * Math.max(gap, USUAL_GAP);
  p.run.now = iso();
  return p;
}

/**
 * A message from the agent, for the dashboard: why the run is happening, a note, a finding (a
 * suspected app bug) or a correction of something said before.
 */
function message({ kind, text, job, scenario, link, }) {
  if (!['why', 'note', 'finding', 'correction'].includes(kind)) {
    throw new Error(`a message is a why, a note, a finding or a correction, not '${kind}'`);
  }
  if (!text) throw new Error('a message needs its text');
  const m = {
    at: iso(), from: 'agent', kind, text: redact(text),
  };
  if (job) m.job = job;
  if (scenario) m.scenario = scenario;
  if (link) m.link = link;
  return m;
}

/** Where a run's progress lives, and the run the newest progress file belongs to. */
const dirOf = (id) => path.join(LIVE, id);
function newestId() {
  if (!fs.existsSync(LIVE)) return null;
  const ids = fs.readdirSync(LIVE).filter((id) => fs.existsSync(path.join(LIVE, id, 'progress.json'))).sort();
  return ids.length ? ids[ids.length - 1] : null;
}

function load(id) {
  const file = path.join(dirOf(id), 'progress.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** Messages `suite.js say` left for the run, which the running suite takes in. */
const inboxOf = (id) => path.join(dirOf(id), 'messages.ndjson');
function readInbox(id) {
  const file = inboxOf(id);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Adds a message to a run: to its inbox while a suite runs it, else straight to its progress. */
function say(id, m) {
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.appendFileSync(inboxOf(id), `${JSON.stringify(m)}\n`);
}

/** Writes the progress so that a reader never sees half a file. */
function save(p) {
  const dir = dirOf(p.run.id);
  fs.mkdirSync(dir, { recursive: true });
  // Messages written while no suite runs are in the inbox only; the page sees them either way.
  const inbox = readInbox(p.run.id);
  const seen = new Set(p.messages.map((m) => `${m.at} ${m.text}`));
  inbox.filter((m) => !seen.has(`${m.at} ${m.text}`)).forEach((m) => {
    p.messages.push(m);
    apply(p, { type: 'message', at: m.at, kind: m.kind, text: m.text, job: m.job });
  });
  p.run.now = iso();
  const file = path.join(dir, 'progress.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(p));
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = {
  LIVE,
  TAGS,
  STUCK_FACTOR,
  USUAL_GAP,
  newProgress,
  apply,
  message,
  save,
  load,
  say,
  newestId,
  dirOf,
  redact,
  longestGap,
};
