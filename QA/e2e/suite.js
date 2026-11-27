#!/usr/bin/env node
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The e2e suites, each for its moment. One command picks the scenarios, brings up the privnet, the
// emulator and the app of this checkout's sources, and runs them.
//
//   node QA/e2e/suite.js status            what is fresh, what is owed, and how long each run takes
//   node QA/e2e/suite.js dev               while developing, and before opening a PR
//   node QA/e2e/suite.js smoke             a few scenarios of everything, before a push
//   node QA/e2e/suite.js full [--resume]   everything: release QA, or the last check of a change to
//                                          the suite
//   node QA/e2e/suite.js down              gives back kept wallets' funds; takes everything down
//   node QA/e2e/suite.js say <kind> <text> a message on the live dashboard: why, note, finding or
//                                          correction; --job <id>, --link <url>, --run <id>
//
// Options, for `dev` and `smoke` unless said:
//   --only <job>,...   only these jobs: fn/history, ws, send, ... (`status` too)
//   --dry-run          list what would run, and why
//   --fresh            a new wallet for every job, instead of going on with the app's
//   --quick            dev: only a sample of each job a change reaches
//   --all              dev: everything a change reaches directly, on both facades
//   --since <ref>      dev: compare with a git ref instead of with what last passed here
//   --no-build         test the app that is installed, whatever it was built from
//   --retry            full, with --resume: run the jobs that had failures again, and say so
//   --minutes <n>      full: start no job expected to end later than that; go on with --resume
//   --why <text>       why this run: pinned on the live dashboard
//   --name <text>      the run's name on the dashboard
//
// Every run that isn't a dry run shows live on the dashboard (lib/live.js), and prints its link.

// What each scenario last passed with is in ledger.json (committed, of the last full run) and
// evidence/ledger.local.json (this machine's runs). lib/select.js says what counts as changed.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { loadGraph } = require('../graph/tools/load');
const { JOBS, jobsOf, keyOf, ranAll, } = require('./lib/jobs');
const { planScenarios } = require('./lib/plan');
const { ACTION_FILES, flowOf, digest } = require('./lib/flows');
const { treeIndex, workIndex, checkoutIds, appId, } = require('./lib/fingerprint');
const ledger = require('./lib/ledger');
const { reachOf, currentOf, standing, forDev, settled, } = require('./lib/select');
const { smokeOf } = require('./lib/smoke');
const { tokenPlan } = require('./lib/tokenPlan');
const app = require('./lib/app');
const progress = require('./lib/progress');
const live = require('./lib/live');

const E2E = __dirname;
const REPO = path.resolve(E2E, '..', '..');
const EVIDENCE = path.join(E2E, 'evidence');
const RUNS = path.join(REPO, 'QA', 'graph', 'runs');
const FULL = path.join(EVIDENCE, 'full.json');
const MODES = ['status', 'dev', 'smoke', 'full', 'down', 'say'];
// Estimates, in seconds, where the ledger has no time of a scenario.
const SCENARIO = 60;
// Measured on 2026-11-25: a wallet's setup, and each token the app creates for a send-created job.
const SETUP = { unlocked: 160, locked: 230, 'broken-key': 220 };
const CREATED_TOKEN = 100;

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const minutes = (seconds) => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`);
// The run on the live dashboard, once one started.
let liveRun = null;

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const args = { mode, argv: rest };
  const valued = {
    '--only': 'only', '--since': 'since', '--minutes': 'minutes', '--why': 'why', '--name': 'name', '--job': 'job', '--link': 'link', '--run': 'run',
  };
  if (mode === 'say') [args.kind, args.text] = [rest.shift(), rest.shift()];
  const flags = {
    '--dry-run': 'dryRun', '--fresh': 'fresh', '--no-build': 'noBuild', '--resume': 'resume', '--retry': 'retry', '--quick': 'quick', '--all': 'all',
  };
  for (let i = 0; i < rest.length; i += 1) {
    if (valued[rest[i]]) args[valued[rest[i]]] = rest[i += 1];
    else if (flags[rest[i]]) args[flags[rest[i]]] = true;
    else throw new Error(`unknown option ${rest[i]}; see the top of QA/e2e/suite.js`);
  }
  if (!MODES.includes(mode)) throw new Error(`usage: suite.js ${MODES.join('|')}; see the top of QA/e2e/suite.js`);
  const filters = ['only', 'since', 'noBuild', 'fresh', 'quick', 'all'];
  if (mode === 'full' && filters.some((name) => args[name])) {
    throw new Error('a full run takes no filter: it is the one that says everything passed');
  }
  if (args.minutes && !(Number(args.minutes) > 0)) throw new Error('--minutes takes a number');
  return args;
}

/** Every scenario of these jobs, with where it stands. */
function rowsOf(args) {
  const graph = loadGraph(path.join(REPO, 'QA', 'graph', 'graph.yaml'));
  const index = workIndex(REPO);
  const ids = checkoutIds(index, graph, ACTION_FILES);
  const planned = jobsOf(args.only).flatMap((job) => planScenarios(graph, job)
    .map((p) => ({ ...p, job, key: keyOf(p.scenario, job.createdTokens) })));
  const scenarios = new Map(planned.map(({ scenario }) => [scenario.id, scenario]));
  const reach = reachOf(graph, [...scenarios.values()]);
  const entries = ledger.load();
  let base = null;
  if (args.since) {
    const tree = treeIndex(REPO, git('merge-base', args.since, 'HEAD'));
    base = { ids: checkoutIds(tree, graph, ACTION_FILES), lacksKit: !tree['QA/e2e/run.js'] };
  }
  const rows = planned.map((row) => {
    const flow = digest(flowOf(row.scenario, row.outcome));
    const current = currentOf({ ...row, flow }, ids, reach);
    // With --since, what the ref had counts as passed; the flows of then can't be built, so a
    // change to their builders shows as one to the kit.
    const entry = base
      ? { ...currentOf({ ...row, flow }, base.ids, reach), status: 'passed' }
      : entries[row.key];
    return {
      ...row,
      seconds: (entries[row.key] && entries[row.key].seconds) || SCENARIO,
      measured: Boolean(entries[row.key] && entries[row.key].seconds),
      standing: row.skip ? { state: 'skipped', why: [row.skip] } : standing(entry, current, reach[row.scenario.id], {
        lacksKit: Boolean(base && base.lacksKit),
      }),
    };
  });
  return { rows, appSources: appId(index), ids };
}

/** What making a wallet's tokens in the app adds to its setup, for a job with created tokens. */
const createdSeconds = (job, rows) => (job.createdTokens
  ? Object.keys(tokenPlan(rows).tokens).length * CREATED_TOKEN : 0);

/** What running these rows should take: the scenarios, a wallet per state of each job, and the
 * tokens the app creates for each wallet of a job with created tokens. */
function estimate(rows) {
  const wallets = new Map();
  rows.forEach((row) => {
    const key = `${row.job.id} ${row.scenario.values['private-balance']}`;
    wallets.set(key, [...(wallets.get(key) || []), row]);
  });
  const setups = [...wallets].reduce((sum, [key, own]) => (
    sum + SETUP[key.split(' ')[1]] + createdSeconds(own[0].job, own)), 0);
  return rows.reduce((sum, row) => sum + row.seconds, 0) + setups;
}

const byJob = (rows) => JOBS
  .map((job) => ({ job, rows: rows.filter((row) => row.job.id === job.id) }))
  .filter((group) => group.rows.length);

function reasons(rows) {
  const counts = new Map();
  rows.flatMap((row) => row.standing.why)
    .forEach((why) => counts.set(why, (counts.get(why) || 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1]).map(([why, n]) => `${why} (${n})`).join(', ');
}

function printStatus({ rows, appSources }) {
  const states = ['fresh', 'owed', 'changed', 'failed', 'new', 'skipped'];
  console.log(`${'job'.padEnd(20)}${states.map((s) => s.padStart(9)).join('')}${'full run'.padStart(11)}`);
  byJob(rows).forEach(({ job, rows: own }) => {
    const counts = states.map((state) => own.filter((row) => row.standing.state === state).length);
    console.log(`${job.id.padEnd(20)}${counts.map((n) => String(n || '-').padStart(9)).join('')}${minutes(estimate(own)).padStart(11)}`);
  });
  const { run, owed } = forDev(rows, smokeOf);
  const { run: quick } = forDev(rows, smokeOf, { quick: true });
  console.log(`\nfull: ${rows.length} scenarios, about ${minutes(estimate(rows))}`);
  console.log(`dev:  ${run.length} scenarios, about ${minutes(estimate(run))}${run.length ? `; ${reasons(run)}` : ''}`);
  console.log(`dev --quick: ${quick.length} scenarios, about ${minutes(estimate(quick))}`);
  if (owed.length) console.log(`owed after dev, until a full run: ${owed.length}; ${reasons(owed)}`);
  if (fs.existsSync(FULL)) console.log('a full run is under way: suite.js full --resume');
  const built = app.builtId() === appSources ? 'up to date' : 'older than the sources: the next run builds it';
  console.log(`app: ${built}`);
}

function list(rows) {
  byJob(rows).forEach(({ job, rows: own }) => {
    console.log(`${job.id}: ${own.length}, about ${minutes(estimate(own))}`);
    own.forEach((row) => console.log(`  ${row.scenario.id.split(':').pop()} -> ${row.outcome.id}  [${row.standing.state}: ${row.standing.why.join(', ') || 'asked for'}]`));
  });
}

// What lib/app.js says it does, as the dashboard's phases. A build blocks the suite for up to
// 5 min, heartbeat included, so the page is told to expect that silence.
// Each: what it usually takes, and how long a silence it may cause (seconds).
const PHASES = [
  [/^building/, 'build', 300, 600], [/^installing/, 'build', 30, 120], [/^booting/, 'boot', 150, 0], [/^starting the privnet/, 'boot', 60, 0],
];
function phaseLog(msg) {
  log(msg);
  const found = PHASES.find(([pattern]) => pattern.test(msg)) || [];
  const [, phase, expectedSeconds, quietSeconds] = found;
  if (liveRun && phase) {
    liveRun.event({
      type: 'phase', phase, text: msg, expectedSeconds, quietSeconds,
    });
  }
}

const onWalletService = (rows) => rows.some(({ job }) => job.setup.includes('-ws-'));

/**
 * The privnet a job runs on (lib/jobs.js). A switch to the other starts a new chain: the wallets
 * kept on the old one give back their funds first, and are forgotten.
 */
const privnetFor = (job, rows) => (
  app.ensurePrivnet(onWalletService(rows), phaseLog, job.privnet, giveBackKept));

async function bringUp(rows, args, appSources) {
  await privnetFor(rows[0].job, rows);
  await app.ensureEmulator(phaseLog);
  if (args.noBuild) {
    const stale = app.staleApp(appSources);
    if (stale) log(`WARNING: ${stale}; its results won't count`);
  } else {
    app.ensureApp(appSources, phaseLog);
  }
  if (liveRun) liveRun.progress.run.app = appLabel(appSources);
}

/** The app the run tests, as the dashboard's header says it. */
function appLabel(appSources) {
  const { version } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  return `${version}-e2e, ${app.installedId() === appSources ? 'built from these sources' : 'NOT built from these sources'}`;
}

/** The scenarios a run leaves out that may need running, by reason, for the dashboard. */
function notCoveredOf(left, clearedBy) {
  const byReason = new Map();
  left.filter((row) => !settled(row)).forEach((row) => {
    const reasonsOf = row.standing.why.length ? row.standing.why : [row.standing.state];
    reasonsOf.forEach((why) => {
      const entry = byReason.get(why) || { reason: why, count: 0, scenarios: [] };
      entry.count += 1;
      entry.scenarios.push(`${row.job.id} ${row.scenario.id.split(':').pop()}`);
      byReason.set(why, entry);
    });
  });
  return {
    owed: left.filter((row) => !settled(row)).length,
    fresh: left.filter((row) => row.standing.state === 'fresh').length,
    byReason: [...byReason.values()].sort((a, b) => b.count - a.count),
    clearedBy,
    notes: ['Android only, on the emulator; iOS is not part of this kit.'],
  };
}

/**
 * Opens the run on the live dashboard. `run` are the rows it runs, `all` every row it could have,
 * `left` those it leaves out that the dashboard lists as not covered.
 */
async function openLive(args, { mode, run, all, left, id, clearedBy, }) {
  const tree = dirty() ? 'uncommitted changes' : 'clean';
  const fresh = () => progress.newProgress({
    id,
    mode,
    name: args.name || `${mode} run of ${git('rev-parse', '--abbrev-ref', 'HEAD')}`,
    commit: git('rev-parse', '--short=8', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    tree,
    device: `Android emulator (${process.env.AVD || 'hnni'})`,
    selection: { options: [mode, ...args.argv].join(' '), picked: run.length, of: all.length },
    notCovered: notCoveredOf(left, clearedBy),
  }, byJob(run), { setupSeconds: SETUP, extraSeconds: createdSeconds });
  liveRun = await live.open({
    id, fresh, log, why: args.why, name: args.name,
  });
  return liveRun;
}

/** Ends the run on the dashboard. */
function closeLive(event) {
  if (!liveRun) return;
  liveRun.event({ type: 'run-finished', ...event });
  liveRun.close();
}

/** One run of run.js; gives the results file's path, or null when it didn't finish. */
function runJob(job, scenarioIds, options) {
  const argv = [path.join(E2E, 'run.js'), '--setup', job.setup, '--action', job.action, ...options];
  if (job.createdTokens) argv.push('--created-tokens');
  if (scenarioIds) argv.push('--scenarios', scenarioIds.join(','));
  return new Promise((resolve, reject) => {
    const child = spawn('node', argv, { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
    child.on('message', (m) => {
      if (liveRun && m && m.e2e) liveRun.event({ ...m.e2e, job: job.id });
    });
    let out = '';
    child.stdout.on('data', (text) => {
      out += text;
      process.stdout.write(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const passed = /passed (\d+), failed (\d+), skipped (\d+)/.exec(out);
      const [n, failed, skipped] = passed ? passed.slice(1).map(Number) : [];
      resolve(code === 0 && passed ? { passed: n, failed, skipped } : null);
    });
  });
}

/** Runs the rows job by job, and says what came of them. */
async function runRows(rows, args, appSources) {
  await bringUp(rows, args, appSources);
  const summary = [];
  // A job whose wallet the next can go on with comes right before it.
  for (const { job, rows: own } of byJob(rows)) {
    // eslint-disable-next-line no-await-in-loop
    await privnetFor(job, rows);
    log(`== ${job.id}: ${own.length} scenarios`);
    const options = ['--results', path.join(EVIDENCE, 'results')];
    options.push(args.fresh ? '--keep' : '--reuse');
    liveRun.event({ type: 'job-started', job: job.id, tries: 1 });
    // eslint-disable-next-line no-await-in-loop
    const counts = await runJob(job, own.map((row) => row.scenario.id), options);
    liveRun.event({ type: 'job-finished', job: job.id, counts });
    summary.push({ job, counts, planned: own.length });
  }
  return summary;
}

/** The dashboard's end of a dev or smoke run. */
function finishLive(summary) {
  const failed = summary.some(({ counts }) => !counts || counts.failed);
  closeLive({ text: failed ? 'finished, NOT all passed' : 'finished, all passed' });
}

function printSummary(summary) {
  console.log('');
  summary.forEach(({ job, counts, planned, tries = 1, }) => {
    const again = tries > 1 ? ` (try ${tries})` : '';
    console.log(`${job.id.padEnd(20)} ${counts ? `passed ${counts.passed}, failed ${counts.failed}, skipped ${counts.skipped}` : `did not finish (${planned} planned)`}${again}`);
  });
  // A skip is a scenario the kit can't run yet (lib/unrunnable.js), which every run lists.
  const ok = summary.every(({ counts, planned }) => ranAll(counts, planned));
  const skipped = summary.reduce((sum, { counts }) => sum + ((counts && counts.skipped) || 0), 0);
  const skips = skipped ? `, ${skipped} skipped as the kit can't run them yet (lib/unrunnable.js)` : '';
  console.log(ok ? `all passed${skips}` : 'NOT all passed; failures: the job\'s viewer, or failure.png in its evidence. On a reused wallet, try --fresh.');
  if (!ok) process.exitCode = 1;
  return ok;
}

function announceOwed(owed) {
  if (owed.length) log(`owed, not run: ${owed.length} scenarios the changes may reach (${reasons(owed)}); a full run clears them`);
}

async function dev(args) {
  const { rows, appSources } = rowsOf(args);
  const { run, owed } = forDev(rows, smokeOf, args);
  if (!run.length) {
    log(args.since ? `nothing to run: nothing that reaches a scenario differs from ${args.since}`
      : 'nothing to run: every scenario last passed with what is here');
    announceOwed(owed);
    return;
  }
  log(`dev: ${run.length} of ${rows.length} scenarios, about ${minutes(estimate(run))}: ${reasons(run)}`);
  if (args.dryRun) {
    list(run);
    announceOwed(owed);
    return;
  }
  await openLive(args, {
    mode: 'dev', run, all: rows, left: owed, id: live.runId('dev'), clearedBy: 'npm run e2e:full',
  });
  const summary = await runRows(run, args, appSources);
  finishLive(summary);
  printSummary(summary);
  announceOwed(owed);
}

async function smoke(args) {
  const { rows, appSources } = rowsOf(args);
  const run = byJob(rows).flatMap(({ rows: own }) => smokeOf(own));
  log(`smoke: ${run.length} of ${rows.length} scenarios, about ${minutes(estimate(run))}`);
  if (args.dryRun) {
    list(run);
    return;
  }
  await openLive(args, {
    mode: 'smoke', run, all: rows, left: rows.filter((row) => !run.includes(row)), id: live.runId('smoke'), clearedBy: 'npm run e2e:dev, or npm run e2e:full',
  });
  const summary = await runRows(run, args, appSources);
  finishLive(summary);
  printSummary(summary);
}

/** The tree's uncommitted changes, but for the results and the ledger a full run itself writes. */
const dirty = () => git('status', '--porcelain', '--', '.', ':(exclude)QA/graph/runs', ':(exclude)QA/e2e/ledger.json');

async function full(args) {
  const { rows, appSources, ids } = rowsOf(args);
  const wanted = rows.map(({ key, outcome }) => [key, outcome.id]);
  const code = digest(JSON.stringify([ids, appSources, wanted]));
  if (args.dryRun) {
    log(`full: ${rows.length} scenarios, about ${minutes(estimate(rows))}`);
    list(rows);
    return;
  }
  if (dirty()) throw new Error(`a full run needs a clean tree, as its results are of a commit:\n${dirty()}`);
  let state = fs.existsSync(FULL) ? JSON.parse(fs.readFileSync(FULL, 'utf8')) : null;
  if (state && !args.resume) throw new Error(`a full run of ${state.startedAt} is under way: --resume it, or delete ${path.relative(REPO, FULL)}`);
  if (!state && args.resume) throw new Error('there is no full run to resume');
  if (state && state.code !== code) throw new Error('the code changed since this full run started, so its results would be of two versions: delete evidence/full.json and start over');
  state = state || {
    startedAt: new Date().toISOString(), code, commit: git('rev-parse', 'HEAD'), done: {}, liveId: live.runId('full'), parts: 0,
  };
  // A full run from before the dashboard goes on under a new id.
  state.liveId = state.liveId || live.runId('full');
  state.parts = (state.parts || 0) + 1;
  const save = () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(FULL, JSON.stringify(state, null, 1));
  };
  save();
  const end = args.minutes ? Date.now() + Number(args.minutes) * 60000 : Infinity;
  const resume = `npm run e2e:full -- --resume${args.minutes ? ` --minutes ${args.minutes}` : ''}`;
  await openLive(args, {
    mode: 'full', run: rows, all: rows, left: [], id: state.liveId, clearedBy: null,
  });
  liveRun.event({
    type: 'part-started', n: state.parts, minutes: args.minutes ? Number(args.minutes) : null, endsBy: Number.isFinite(end) ? new Date(end).toISOString() : null,
  });
  liveRun.progress.run.resume = resume;
  await bringUp(rows, {}, appSources);
  const failedIn = (done) => !ranAll(done.counts, done.planned);
  const todo = byJob(rows).filter(({ job }) => {
    const done = state.done[job.id];
    return !done || (args.retry && failedIn(done));
  });
  for (const { job, rows: own } of todo) {
    if (Date.now() + estimate(own) * 1000 > end) {
      log(`stopping before ${job.id}, about ${minutes(estimate(own))}: go on with suite.js full --resume`);
      liveRun.event({ type: 'part-ended', text: `part ${state.parts} ended before ${job.id}; the rest needs a resume`, resume });
      liveRun.close();
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await privnetFor(job, rows);
    log(`== ${job.id}: ${own.length} scenarios, about ${minutes(estimate(own))}`);
    const before = state.done[job.id];
    liveRun.event({ type: 'job-started', job: job.id, tries: before ? before.tries + 1 : 1 });
    // eslint-disable-next-line no-await-in-loop
    const counts = await runJob(job, null, ['--results', RUNS]);
    liveRun.event({ type: 'job-finished', job: job.id, counts });
    if (!counts) {
      closeLive({ state: 'stopped', text: `${job.id} did not finish`, resume: 'npm run e2e:full -- --resume' });
      throw new Error(`${job.id} did not finish; fix what stopped it, then suite.js full --resume`);
    }
    state.done[job.id] = {
      counts, planned: own.length, tries: before ? before.tries + 1 : 1,
    };
    save();
  }
  if (Object.values(state.done).some(failedIn) && !args.retry) {
    printSummary(byJob(rows).map(({ job }) => ({ job, ...state.done[job.id] })));
    log('every job ran, some with failures: --resume --retry runs those again');
    closeLive({ text: 'every job ran, some with failures', resume: 'npm run e2e:full -- --resume --retry' });
    return;
  }
  // A skipped scenario has no result to keep (lib/unrunnable.js).
  ledger.commitBaseline(rows.filter((row) => !row.skip).map(({ key }) => key), state.startedAt);
  fs.rmSync(FULL);
  log(`full run of ${state.commit.slice(0, 8)}: ${rows.length} scenarios; commit the results in QA/graph/runs and ledger.json`);
  closeLive({ text: `finished: the baseline ledger of ${state.commit.slice(0, 8)} is written` });
  printSummary(byJob(rows).map(({ job }) => ({ job, ...state.done[job.id] })));
}

/** Gives back the funds of every wallet a run kept, and forgets them: no run goes on with them. */
function giveBackKept() {
  const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []);
  const find = (dir, depth) => (depth < 0 ? [] : entries(dir)
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return find(file, depth - 1);
      return entry.name === 'wallet.json' ? [file] : [];
    }));
  find(EVIDENCE, 2).forEach((file) => {
    const dir = path.dirname(file);
    if (fs.existsSync(path.join(dir, 'treasury.seed'))) {
      log(`giving back the funds of ${path.relative(E2E, dir)}`);
      try {
        execFileSync('node', [path.join(E2E, 'tools', 'wallet.js'), 'cleanup', dir], { stdio: 'ignore' });
      } catch (e) {
        log(`  failed; retry: node QA/e2e/tools/wallet.js cleanup ${path.relative(REPO, dir)}`);
        return;
      }
    }
    fs.rmSync(file);
  });
}

/** Gives back the funds of every wallet a run kept, and takes the privnet and the emulator down. */
function down() {
  giveBackKept();
  app.down(log);
}

/** Leaves a message on a run's dashboard: the newest run, or --run's. */
function say(args) {
  const id = args.run || progress.newestId();
  if (!id) throw new Error('there is no run on the dashboard to say it to');
  progress.say(id, progress.message({
    kind: args.kind, text: args.text, job: args.job, link: args.link,
  }));
  log(`said to ${id}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'status') printStatus(rowsOf(args));
  else if (args.mode === 'dev') await dev(args);
  else if (args.mode === 'smoke') await smoke(args);
  else if (args.mode === 'full') await full(args);
  else if (args.mode === 'say') say(args);
  else down();
}

// Stopped by hand: the dashboard says so, instead of going silent.
['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => {
  if (liveRun) closeLive({ state: 'stopped', text: `stopped by ${signal}`, resume: liveRun.progress.run.mode === 'full' ? 'npm run e2e:full -- --resume' : undefined });
  process.exit(130);
}));

main().catch((e) => {
  console.error(`suite: ${e.message}`);
  if (liveRun && !['finished', 'stopped', 'paused'].includes(liveRun.progress.run.state)) {
    closeLive({ state: 'stopped', text: `stopped: ${e.message}` });
  }
  process.exit(1);
});
