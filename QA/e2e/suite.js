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
//
// Options, for `dev` and `smoke` unless said:
//   --only <job>,...   only these jobs: fn/history, ws, send, ... (`status` too)
//   --dry-run          list what would run, and why
//   --fresh            a new wallet for every job, instead of going on with the app's
//   --quick            dev: only a sample of each job a change reaches
//   --all              dev: everything a change reaches directly, on both facades
//   --since <ref>      dev: compare with a git ref instead of with what last passed here
//   --no-build         test the app that is installed, whatever it was built from
//   --minutes <n>      full: start no job expected to end later than that; go on with --resume
//
// What each scenario last passed with is in ledger.json (committed, of the last full run) and
// evidence/ledger.local.json (this machine's runs). lib/select.js says what counts as changed.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { loadGraph } = require('../graph/tools/load');
const { JOBS, jobsOf, keyOf } = require('./lib/jobs');
const { planScenarios } = require('./lib/plan');
const { ACTION_FILES, flowOf, digest } = require('./lib/flows');
const { treeIndex, workIndex, checkoutIds, appId, } = require('./lib/fingerprint');
const ledger = require('./lib/ledger');
const { reachOf, currentOf, standing, forDev, } = require('./lib/select');
const { smokeOf } = require('./lib/smoke');
const app = require('./lib/app');

const E2E = __dirname;
const REPO = path.resolve(E2E, '..', '..');
const EVIDENCE = path.join(E2E, 'evidence');
const RUNS = path.join(REPO, 'QA', 'graph', 'runs');
const FULL = path.join(EVIDENCE, 'full.json');
const MODES = ['status', 'dev', 'smoke', 'full', 'down'];
// Estimates, in seconds, where the ledger has no time of a scenario.
const SCENARIO = 60;
const SETUP = { unlocked: 150, locked: 240, 'broken-key': 240 };

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const minutes = (seconds) => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`);

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const args = { mode };
  const valued = { '--only': 'only', '--since': 'since', '--minutes': 'minutes' };
  const flags = {
    '--dry-run': 'dryRun', '--fresh': 'fresh', '--no-build': 'noBuild', '--resume': 'resume', '--quick': 'quick', '--all': 'all',
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
      standing: standing(entry, current, reach[row.scenario.id], {
        lacksKit: Boolean(base && base.lacksKit),
      }),
    };
  });
  return { rows, appSources: appId(index), ids };
}

/** What running these rows should take: the scenarios, and a wallet per state of each job. */
function estimate(rows) {
  const wallets = new Set(rows.map(({ job, scenario }) => `${job.id} ${scenario.values['private-balance']}`));
  return rows.reduce((sum, row) => sum + row.seconds, 0)
    + [...wallets].reduce((sum, wallet) => sum + SETUP[wallet.split(' ')[1]], 0);
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
  const states = ['fresh', 'owed', 'changed', 'failed', 'new'];
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

async function bringUp(rows, args, appSources) {
  await app.ensurePrivnet(rows.some(({ job }) => job.setup.startsWith('pn-ws')), log);
  await app.ensureEmulator(log);
  if (args.noBuild) {
    const stale = app.staleApp(appSources);
    if (stale) log(`WARNING: ${stale}; its results won't count`);
    return;
  }
  app.ensureApp(appSources, log);
}

/** One run of run.js; gives the results file's path, or null when it didn't finish. */
function runJob(job, scenarioIds, options) {
  const argv = [path.join(E2E, 'run.js'), '--setup', job.setup, '--action', job.action, ...options];
  if (job.createdTokens) argv.push('--created-tokens');
  if (scenarioIds) argv.push('--scenarios', scenarioIds.join(','));
  return new Promise((resolve, reject) => {
    const child = spawn('node', argv, { stdio: ['ignore', 'pipe', 'inherit'] });
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
    log(`== ${job.id}: ${own.length} scenarios`);
    const options = ['--results', path.join(EVIDENCE, 'results')];
    options.push(args.fresh ? '--keep' : '--reuse');
    // eslint-disable-next-line no-await-in-loop
    const counts = await runJob(job, own.map((row) => row.scenario.id), options);
    summary.push({ job, counts, planned: own.length });
  }
  return summary;
}

function printSummary(summary) {
  console.log('');
  summary.forEach(({ job, counts, planned }) => {
    console.log(`${job.id.padEnd(20)} ${counts ? `passed ${counts.passed}, failed ${counts.failed}, skipped ${counts.skipped}` : `did not finish (${planned} planned)`}`);
  });
  const ok = summary.every(({ counts, planned }) => counts && counts.passed === planned);
  console.log(ok ? 'all passed' : 'NOT all passed; failures: the job\'s viewer, or failure.png in its evidence. On a reused wallet, try --fresh.');
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
    log('nothing to run: every scenario last passed with what is here, or is owed');
    announceOwed(owed);
    return;
  }
  log(`dev: ${run.length} of ${rows.length} scenarios, about ${minutes(estimate(run))}: ${reasons(run)}`);
  if (args.dryRun) {
    list(run);
    announceOwed(owed);
    return;
  }
  printSummary(await runRows(run, args, appSources));
  announceOwed(owed);
}

async function smoke(args) {
  const { rows, appSources } = rowsOf(args);
  const run = byJob(rows).flatMap(({ rows: own }) => smokeOf(own));
  log(`smoke: ${run.length} of ${rows.length} scenarios, about ${minutes(estimate(run))}`);
  if (args.dryRun) list(run);
  else printSummary(await runRows(run, args, appSources));
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
  state = state || { startedAt: new Date().toISOString(), code, commit: git('rev-parse', 'HEAD'), done: {} };
  const save = () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(FULL, JSON.stringify(state, null, 1));
  };
  save();
  const end = args.minutes ? Date.now() + Number(args.minutes) * 60000 : Infinity;
  await bringUp(rows, {}, appSources);
  for (const { job, rows: own } of byJob(rows).filter((group) => !state.done[group.job.id])) {
    if (Date.now() + estimate(own) * 1000 > end) {
      log(`stopping before ${job.id}, about ${minutes(estimate(own))}: go on with suite.js full --resume`);
      return;
    }
    log(`== ${job.id}: ${own.length} scenarios, about ${minutes(estimate(own))}`);
    // eslint-disable-next-line no-await-in-loop
    const counts = await runJob(job, null, ['--results', RUNS]);
    if (!counts) throw new Error(`${job.id} did not finish; fix what stopped it, then suite.js full --resume`);
    state.done[job.id] = { counts, planned: own.length };
    save();
  }
  ledger.commitBaseline(rows.map(({ key }) => key), state.startedAt);
  fs.rmSync(FULL);
  log(`full run of ${state.commit.slice(0, 8)}: ${rows.length} scenarios; commit the results in QA/graph/runs and ledger.json`);
  printSummary(byJob(rows).map(({ job }) => ({ job, ...state.done[job.id] })));
}

/** Gives back the funds of every wallet a run kept, and takes the privnet and the emulator down. */
function down() {
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
  app.down(log);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'status') printStatus(rowsOf(args));
  else if (args.mode === 'dev') await dev(args);
  else if (args.mode === 'smoke') await smoke(args);
  else if (args.mode === 'full') await full(args);
  else down();
}

main().catch((e) => {
  console.error(`suite: ${e.message}`);
  process.exit(1);
});
