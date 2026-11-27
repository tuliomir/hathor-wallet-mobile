#!/usr/bin/env node
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Runs the QA graph's scenarios of one action on one setup, on the emulator and the local privnet,
// and writes one results file. The low-level command: suite.js (README "Which command to run")
// picks the scenarios, brings up what they need and calls this.
//
//   node QA/e2e/run.js --setup <setup> [--action <action>] [--scenarios <id>,<id>] [--dry-run]
//                      [--unlocked] [--created-tokens] [--affected <pick>,<pick>] [--since <ref>]
//                      [--keep] [--reuse] [--no-cleanup] [--no-record] [--results <dir>]
//
// --unlocked picks scenarios as if an unlocked private balance were the only one, so the cover
// is all spent on that state. --created-tokens (send only) sends only custom tokens, made in the
// app by the run instead of minted from outside.
//
// --affected runs only the scenarios the graph's impact tool says a change reaches, each pick a
// feature, a flag or an <axis>:<value>; --since picks the features whose files changed since a
// git ref, uncommitted changes included.
//
// --keep leaves the wallet of the run in the app, and --reuse starts from it, when it fits the
// scenarios, instead of onboarding a new one (2 to 4 min). For developing: what a scenario leaves
// behind can change the next one, so a failure on a reused wallet is worth a run on a fresh one.
//
// The run records the emulator's screen through each flow but onboarding, and writes viewer.html
// in its evidence dir: the recordings as a playlist, each beside its steps, the running one
// marked, for a person to watch what the run did (README "Watching a run"). --no-record skips the
// recordings.
//
// After the scenarios, the run's HTR and token deposits go back to the genesis wallet (cleanup in
// tools/wallet.js), so a privnet lasts hundreds of runs. --no-cleanup keeps them, to look at the
// wallets afterwards; `node QA/e2e/tools/wallet.js cleanup <evidence dir>` gives them back later.
//
// Needs the privnet up (QA/e2e/privnet) and the emulator running the app: a release build (README
// "Run"), or a debug build with Metro serving its JS. Scenarios the kit can't set up yet are
// recorded as skipped, with the reason.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
// eslint-disable-next-line import/no-extraneous-dependencies
const YAML = require('yaml');
const { loadGraph } = require('../graph/tools/load');
const { assertEmulator } = require('./lib/device');
const sendFlow = require('./lib/sendFlow');
const createTokenFlow = require('./lib/createTokenFlow');
const { planScenarios } = require('./lib/plan');
const flows = require('./lib/flows');
const ledger = require('./lib/ledger');
const { keyOf } = require('./lib/jobs');
const { workIndex, checkoutIds, appId } = require('./lib/fingerprint');
const { reachOf, currentOf } = require('./lib/select');
const { staleApp } = require('./lib/app');
const { screenOf } = require('./lib/screen');
const { payAgain } = require('./lib/payAgain');
const { runReceive } = require('./lib/receiveScenarios');
const { runPayment, runHistory } = require('./lib/historyScenarios');
const { runRegister } = require('./lib/registerScenarios');
const { runResetImport } = require('./lib/resetScenarios');
const { runSettings } = require('./lib/settingsScenarios');
const { runAddressMode } = require('./lib/addressModeScenarios');
const { tokenPlan } = require('./lib/tokenPlan');
const walletStart = require('./lib/walletStart');
const { htrOnDashboard, numpadKeys } = require('./lib/dashboard');
const { reachedIn, BACK } = require('./lib/flowSteps');
const { keysTapped, startPinServer } = require('./lib/pinServer');
const { pickOf, picksOfFiles, affectedIds } = require('./lib/affected');
const { startRecording, blackout } = require('./lib/recorder');
const { entriesFrom, runnerEntry, skipRanges } = require('./lib/timeline');

const E2E = __dirname;
const REPO = path.resolve(E2E, '..', '..');
const ADB = process.env.ADB || path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const MAESTRO = process.env.MAESTRO || path.join(os.homedir(), '.maestro/maestro/bin/maestro');
const MAESTRO_ENV = {
  ...process.env,
  MAESTRO_CLI_NO_ANALYTICS: '1',
  JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64',
};
const NODE_URL = 'http://localhost:18083/v1a/';
const FUNDING_URL = 'http://localhost:13020';
const UNLEASH_URL = 'http://localhost:18042';
const WALLET_SERVICE_URL = 'http://localhost:18300/dev/';
const TOP_UP_HTR = '20';
const HTR = { name: 'Hathor', symbol: 'HTR', uid: '00' };
// Each private balance state gets a wallet of its own, in this order.
const STATES = ['unlocked', 'locked', 'broken-key'];
// Received privately before the wallet is locked, so there is something locked.
const PRIVATE_HTR = '5';
// What the payer pays the app of each custom token, before the payments and the history entries.
const PAID_TOKENS = '10000';
const PAID_HTR = '50';
// Which wallet the app holds, on the device, for --reuse.
const WALLET_MARK = '/data/local/tmp/e2e-wallet';
const PIN = '123456';
const ACCESS_KEY = 'asyncstorage:access';
const DB = '/data/data/network.hathor.wallet/databases/RKStorage';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
// What the run does, for the live dashboard (lib/progress.js). Only suite.js opens the channel:
// run alone, run.js reports nothing.
const report = (type, data = {}) => {
  if (!process.send || !process.connected) return;
  process.send({ e2e: { type, at: new Date().toISOString(), ...data } });
};

function parseArgs(argv) {
  const args = { action: 'send' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--setup') args.setup = argv[i += 1];
    else if (argv[i] === '--action') args.action = argv[i += 1];
    else if (argv[i] === '--unlocked') args.unlocked = true;
    else if (argv[i] === '--created-tokens') args.createdTokens = true;
    else if (argv[i] === '--scenarios') args.scenarios = argv[i += 1].split(',');
    else if (argv[i] === '--affected') args.affected = argv[i += 1].split(',');
    else if (argv[i] === '--since') args.since = argv[i += 1];
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--keep') args.keep = true;
    else if (argv[i] === '--reuse') Object.assign(args, { reuse: true, keep: true });
    else if (argv[i] === '--results') args.results = argv[i += 1];
    else if (argv[i] === '--no-cleanup') args.noCleanup = true;
    else if (argv[i] === '--no-record') args.noRecord = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.setup) {
    throw new Error(`usage: run.js --setup <setup id> [--action ${flows.ACTIONS.join('|')}] [--scenarios <id>,<id>] [--unlocked] [--created-tokens] [--affected <pick>,<pick>] [--since <git ref>] [--dry-run] [--keep] [--reuse] [--no-cleanup] [--no-record] [--results <dir>]`);
  }
  return args;
}

async function getJson(url, options, retries = 1) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (e) {
    // Usually a kept-alive connection the server closed while the app onboarded. A retry is
    // harmless here: at worst a /fund is paid twice, in privnet coins.
    if (retries > 0) return getJson(url, options, retries - 1);
    throw new Error(`${url}: ${(e.cause && e.cause.message) || e.message}`);
  }
  const body = await response.json();
  if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

// wallet-lib logs to stdout too, so the answer is the last line.
const walletTool = (...args) => execFileSync('node', [path.join(E2E, 'tools', 'wallet.js'), ...args], { encoding: 'utf8' })
  .trim().split('\n').pop();
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

/** Runs a flow, leaving the runner free to answer it (lib/pinServer.js). */
async function maestro(flow, outDir, retries = 1) {
  const args = ['test', `--test-output-dir=${outDir}`, `--debug-output=${outDir}`, flow];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(MAESTRO, args, { env: MAESTRO_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = { stdout: '', stderr: '' };
    ['stdout', 'stderr'].forEach((name) => {
      child[name].setEncoding('utf8');
      child[name].on('data', (text) => { out[name] += text; });
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ ...out, status }));
  });
  fs.writeFileSync(path.join(outDir, 'maestro.out'), `${result.stdout}\n${result.stderr}`);
  // Maestro's on-device driver sometimes fails to start; that's not the flow's doing.
  if (retries > 0 && `${result.stdout}${result.stderr}`.includes('MaestroDriverStartupException')) {
    return maestro(flow, outDir, retries - 1);
  }
  const failed = (result.stdout.match(/^.*FAILED.*$/m) || [])[0];
  return { ok: result.status === 0, failed: failed && failed.trim() };
}

// Maestro puts its logs in timestamped folders under --debug-output.
function findFiles(dir, name) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(full, name);
    return entry.name === name ? [full] : [];
  });
}

async function preflight(setup) {
  const checks = [
    ['privnet fullnode', () => getJson(`${NODE_URL}status`)],
    ['funding helper', async () => { if (!(await getJson(`${FUNDING_URL}/ready`)).ready) throw new Error('not ready'); }],
    ['fake Unleash', () => getJson(`${UNLEASH_URL}/flags`)],
    ['emulator', async () => assertEmulator(ADB)],
  ];
  if (setup.values.facade === 'wallet-service') {
    checks.push(['wallet service (compose profile ws)', () => getJson(`${WALLET_SERVICE_URL}version`)]);
  }
  for (const [name, check] of checks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await check();
    } catch (e) {
      throw new Error(`${name} is not available (${e.message}); see QA/e2e/README.md "Run by hand"`);
    }
  }
}

async function receivedBy(address, uid = '00') {
  const body = await getJson(`${NODE_URL}thin_wallet/address_balance?address=${address}`);
  return BigInt((body.tokens_data && body.tokens_data[uid] && body.tokens_data[uid].received) || 0);
}

async function fund(address, htr) {
  const before = await receivedBy(address);
  const cents = Math.round(Number(htr) * 100);
  await payAgain(() => getJson(`${FUNDING_URL}/fund`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, amount: cents }),
  }));
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await receivedBy(address) > before) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  throw new Error(`funding ${address} did not land`);
}

/**
 * Runs `body` as one chapter of the run's recording: the screen is recorded from start to end,
 * and the chapter's timeline (the runner's own steps and every flow's commands) goes to the
 * viewer. `body` gets `step(text, fn)`, to time a runner step, and `flow(file, outDir, as)`, to
 * run a Maestro flow; with `as`, the flow's commands nest under a step of that name.
 */
async function chapter(ctx, info, dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  const parts = [];
  const api = {
    async step(text, fn) {
      report('step', { text });
      const start = Date.now();
      try {
        return await fn();
      } finally {
        parts.push({ start, end: Date.now(), text });
      }
    },
    /** A runner step whose screen shows a secret: blacked out in the recording. */
    async hidden(text, fn) {
      report('step', { text });
      const start = Date.now();
      try {
        return await fn();
      } finally {
        parts.push({
          start, end: Date.now(), text: `${text} (hidden in the recording)`, hidden: true,
        });
      }
    },
    async flow(file, outDir, as) {
      report('step', { text: as || `Maestro: ${path.basename(file)}` });
      const start = Date.now();
      const result = await maestro(file, outDir);
      parts.push({ start, end: Date.now(), text: as, outDir });
      return result;
    },
  };
  if (!ctx.record) return body(api);
  const recording = await startRecording(ADB);
  let result;
  let error;
  try {
    result = await body(api);
  } catch (e) {
    error = e;
  }
  const video = path.join(dir, 'screen.mp4');
  const stoppedAt = await recording.stop(video);
  const { t0 } = recording;
  // Half a second either side: the frames' times are good to about 0.2 s (README "Watching a run").
  blackout(video, parts.filter((part) => part.hidden)
    .map((part) => [Math.max(0, (part.start - t0) / 1000 - 0.5), (part.end - t0) / 1000 + 0.5]));
  const flowDirs = parts.filter((part) => part.outDir).map((part) => part.outDir);
  const entries = parts.flatMap((part) => {
    if (!part.outDir) return [runnerEntry(part, t0)];
    // A flow's own logs, not those of a flow run from a folder inside its own.
    const nested = flowDirs.filter((other) => other !== part.outDir && other.startsWith(`${part.outDir}${path.sep}`));
    const commands = findFiles(part.outDir, 'commands.json')
      .filter((file) => !nested.some((other) => file.startsWith(other)))
      .flatMap((file) => entriesFrom(JSON.parse(fs.readFileSync(file, 'utf8')), t0, part.text ? 1 : 0));
    return part.text ? [runnerEntry(part, t0), ...commands] : commands;
  }).sort((a, b) => a.t - b.t || a.depth - b.depth);
  const duration = (stoppedAt - t0) / 1000;
  ctx.chapters.push({
    ...info,
    status: error ? 'failed' : (result && result.status) || 'done',
    notes: error ? error.message : (result && result.notes) || '',
    video: path.relative(ctx.runDir, video),
    duration,
    entries,
    skips: skipRanges(entries, duration),
  });
  writeViewer(ctx);
  if (error) throw error;
  return result;
}

/** Writes the run's viewer.html (the viewer with the run's data in it) and the runs' index. */
function writeViewer(ctx) {
  const template = fs.readFileSync(path.join(E2E, 'viewer', 'viewer.html'), 'utf8');
  const data = { ...ctx.runInfo, chapters: ctx.chapters };
  // In a <script>, "</" would end it early.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  fs.writeFileSync(path.join(ctx.runDir, 'viewer.html'), template.replace('/* RUN_DATA */ null', () => json));
  const evidence = path.dirname(ctx.runDir);
  const runs = fs.readdirSync(evidence).filter((name) => fs.existsSync(path.join(evidence, name, 'viewer.html'))).sort().reverse();
  const items = runs.map((name) => `<li><a href="${name}/viewer.html">${name}</a></li>`).join('\n');
  fs.writeFileSync(path.join(evidence, 'index.html'), `<!doctype html><meta charset="utf-8"><title>e2e runs</title>
<style>body{font:15px system-ui;margin:2em;background:#111;color:#eee}a{color:#8cf}</style><h1>e2e runs</h1>
<p><a href="live/">Live dashboard of the suite runs</a></p><ul>${items}</ul>`);
}

/** The token a create flow left on its details screen, as the fullnode knows it. */
async function createdToken(dir) {
  const config = findFiles(dir, 'maestro.log')
    .map((file) => (fs.readFileSync(file, 'utf8').match(/JsConsole: E2E_TOKEN \[(.+):([^:]+):([0-9a-f]{64}):[0-9a-f]+\]/) || []))
    .find((match) => match.length);
  if (!config) throw new Error('could not read the new token\'s configuration string');
  const uid = config[3];
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const token = await getJson(`${NODE_URL}thin_wallet/token?id=${uid}`);
    if (token.success) {
      const { name, symbol, total, version } = token;
      return { uid, name, symbol, total: BigInt(total), version };
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  throw new Error(`the fullnode does not know the new token ${uid}`);
}

/**
 * Runs a scenario's flow, which ends by going back to the dashboard. When it fails before that,
 * a flow of its own goes back; `back` is false when the app is still elsewhere.
 */
async function runToOutcome(flow, flowFile, dir, outcome, ctx, as) {
  ['enter_pin.yaml', 'to_dashboard.yaml'].forEach((name) => {
    fs.copyFileSync(path.join(E2E, 'flows', name), path.join(dir, '..', name));
  });
  const result = await flow(flowFile, dir, as);
  const logs = findFiles(dir, 'maestro.log').map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const ok = reachedIn(logs, outcome);
  if (!ctx.pinUrl) {
    const keys = keysTapped(logs);
    if ([...PIN].every((digit) => keys[digit])) {
      Object.assign(ctx, { pinKeys: keys, pinUrl: ctx.pinServer.url });
    }
  }
  let notes = ok ? `reached: ${outcome.id}` : `${result.failed || 'flow failed'}`;
  if (!result.ok) {
    const back = await flow(path.join(E2E, 'flows', 'to_dashboard.yaml'), path.join(dir, 'reset'), BACK);
    if (!back.ok) notes += '; could not return to the dashboard';
  }
  return { ok, notes };
}

// The graph's outcome of a creation that works.
const CREATED = {
  id: 'ok-created',
  kind: 'success',
  at: 'confirm',
  // eslint-disable-next-line no-template-curly-in-string
  message: '**${name}** created successfully',
};

/**
 * Makes a custom token of 1000.00 in the app, paid with exactly what it costs: a wallet that held
 * no HTR holds none after, as the zero-HTR scenarios need.
 */
async function createInApp(ctx, kind, { name, symbol }, dir, { step, flow }) {
  const cost = kind === 'deposit' ? '10' : '0.01';
  await step(`runner: pay the app wallet ${cost} HTR, what ${symbol} costs`, async () => {
    await fund(ctx.appAddress, cost);
    await sleep(6000);
  });
  const scenario = { id: `setup: create ${symbol}`, values: { token: kind, naming: 'valid', 'mint-amount': 'thousand' } };
  const flowFile = path.join(dir, 'flow.yaml');
  fs.mkdirSync(dir, { recursive: true });
  const { pinUrl } = ctx;
  const yaml = createTokenFlow.buildCreateTokenFlow(scenario, CREATED, { name, symbol, pinUrl });
  fs.writeFileSync(flowFile, yaml);
  const result = await runToOutcome(flow, flowFile, dir, CREATED, ctx, `setup: create ${symbol} in the app`);
  if (!result.ok) throw new Error(`creating ${symbol} failed: ${result.notes}`);
  const token = await createdToken(dir);
  return { name, symbol, uid: token.uid };
}

async function createTokensInApp(ctx, dir, wanted) {
  const made = {};
  for (const [key, token] of Object.entries(wanted)) {
    const tokenDir = path.join(dir, `create-${key}`);
    const info = { kind: 'setup', id: `create-${key}`, title: `Setup: create ${token.symbol} in the app` };
    // eslint-disable-next-line no-await-in-loop
    await chapter(ctx, info, tokenDir, async (api) => {
      made[key] = await createInApp(ctx, token.kind, token, path.join(tokenDir, 'flow'), api);
    });
    log(`app: created ${token.symbol} ${made[key].uid}`);
  }
  return made;
}

/** A digest of the flow a scenario runs, the same in every run while the flow is: the viewer
 * uses it to tell which scenarios changed since someone watched them. */
const flowVersion = (scenario, outcome, token, ids) => (
  flows.digest(flows.flowOf(scenario, outcome, token) || ids.actions[scenario.action]));

/** Runs a flow the kit writes: `file` in `dir`, then the Maestro run. */
function runWritten(flow, dir, file, yaml, as) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), yaml);
  return flow(path.join(dir, file), dir, as);
}

async function onboard(setup, dir, ctx) {
  const onWalletService = setup.values.facade === 'wallet-service';
  const flags = { 'wallet-service-mobile.rollout': onWalletService };
  if (setup.values['flag-fbt']) flags['fee-based-tokens.rollout'] = setup.values['flag-fbt'] === 'on';
  await getJson(`${UNLEASH_URL}/flags`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flags),
  });
  adbShell(`rm -f ${WALLET_MARK}`);
  log('app: fresh install on the privnet');
  execFileSync(path.join(E2E, 'bin', 'app-on-privnet.sh'), ['--fresh'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, WALLET_SERVICE: onWalletService ? '1' : '' },
  });
  const onboardDir = path.join(dir, 'onboard');
  const onboardInfo = { kind: 'setup', id: 'onboard', title: 'Onboarding: a new wallet on the privnet' };
  // Not recorded: its screen shows the seed, and the viewer and recordings are made to be shared.
  await chapter({ ...ctx, record: false }, onboardInfo, onboardDir, async ({ flow }) => {
    const result = await flow(path.join(E2E, 'flows', 'onboard.yaml'), onboardDir);
    if (!result.ok) throw new Error(`onboarding failed: ${result.failed}`);
  });
  const seed = findFiles(onboardDir, 'maestro.log')
    .map((file) => (fs.readFileSync(file, 'utf8').match(/JsConsole: E2E_SEED ([a-z ]+)/) || [])[1])
    .find(Boolean);
  if (!seed || seed.trim().split(' ').length !== 24) throw new Error('could not read the wallet seed from onboarding');
  const seedFile = path.join(dir, 'app.seed');
  fs.writeFileSync(seedFile, `${seed.trim()}\n`, { mode: 0o600 });
  const appAddress = walletTool('address', seedFile);
  log(`app: wallet ${appAddress}`);
  if (onWalletService) {
    const checkDir = path.join(dir, 'check-wallet-service');
    const checkInfo = { kind: 'setup', id: 'check-wallet-service', title: 'Setup: the app is on the wallet service' };
    await chapter(ctx, checkInfo, checkDir, async ({ flow }) => {
      const yaml = walletStart.buildServerFlow('wallet-service');
      const check = await runWritten(flow, checkDir, 'flow.yaml', yaml);
      if (!check.ok) throw new Error(`the app is not on the wallet service: ${check.failed}`);
    });
  }
  return { appAddress, seedFile };
}

/** Makes the group's custom tokens, and the destinations, of a send run. */
async function prepareSends(dir, ctx, plan) {
  const { tokens: wanted, keyOf: tokenKeys } = tokenPlan(plan);
  let made = {};
  // The treasury keeps the tokens' authorities, so the cleanup can melt them; tokens.json tells
  // the cleanup what was minted, even when the run stops half-way.
  const treasurySeed = path.join(dir, 'treasury.seed');
  fs.writeFileSync(treasurySeed, `${walletTool('new-seed')}\n`, { mode: 0o600 });
  const minted = [];
  fs.writeFileSync(path.join(dir, 'tokens.json'), '[]');
  if (ctx.createdTokens) {
    made = await createTokensInApp(ctx, dir, wanted);
  } else {
    for (const [key, { kind, name, symbol, units }] of Object.entries(wanted)) {
      const uid = walletTool('mint', ctx.appAddress, kind, name, symbol, units, treasurySeed);
      made[key] = { name, symbol, uid };
      minted.push({ uid, kind, symbol });
      fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(minted, null, 2));
      log(`app: minted ${symbol} ${uid}`);
    }
    const importDir = path.join(dir, 'import-tokens');
    const importInfo = { kind: 'setup', id: 'import-tokens', title: `Setup: import the ${minted.length} minted tokens` };
    await chapter(ctx, importInfo, importDir, async ({ flow }) => {
      const names = Object.values(wanted).map(({ name }) => name);
      const imported = await runWritten(flow, importDir, 'flow.yaml', walletStart.buildImportFlow(names));
      if (!imported.ok) throw new Error(`importing the minted tokens failed: ${imported.failed}`);
    });
  }
  const tokens = { htr: HTR };
  Object.entries(tokenKeys).forEach(([id, key]) => { tokens[id] = key === 'htr' ? HTR : made[key]; });

  const peerSeed = path.join(dir, 'peer.seed');
  fs.writeFileSync(peerSeed, `${walletTool('new-seed')}\n`, { mode: 0o600 });
  // Both single-key destinations are the peer's, a seed the runner holds, so the cleanup can give
  // back what they received; the multisig's keys stay with the helper.
  const destinations = {
    simple: walletTool('address', peerSeed),
    multisig: (await getJson(`${FUNDING_URL}/multisigWallet?participants=3&numSignatures=2`)).wallets[0].addresses[0],
    shielded: walletTool('shielded-address', peerSeed),
  };
  log(`destinations: ${JSON.stringify(destinations)}`);
  return { tokens, destinations, byKind: { deposit: made.deposit, fee: made.fee } };
}

const adbShell = (command) => execFileSync(ADB, ['shell', command], { encoding: 'utf8' }).trim();

/**
 * Starts the app again with its private balance in `state`. For locked and broken-key it gets a
 * private payment first, then its record is rewritten while it is stopped
 * (tools/privateBalance.js).
 */
async function startInState(state, dir, ctx) {
  const stateDir = path.join(dir, 'start');
  const info = { kind: 'setup', id: 'start', title: `Setup: start with the private balance ${state}` };
  await chapter(ctx, info, stateDir, async ({ step, flow }) => {
    if (state !== 'unlocked') {
      await step(`runner: pay the app wallet ${PRIVATE_HTR} HTR privately`, async () => {
        const had = await htrShown(() => true);
        walletTool('send-private', walletTool('shielded-address', ctx.seedFile), PRIVATE_HTR, 'amount');
        await htrShown((cents) => cents === had + BigInt(PRIVATE_HTR) * 100n);
        ctx.locked = 1;
      });
    }
    await step(`runner: stop the app${state === 'unlocked' ? '' : `, make its record ${state}`}`, async () => {
      adbShell('am force-stop network.hathor.wallet');
      if (state === 'unlocked') return;
      const record = path.join(stateDir, 'record.json');
      fs.writeFileSync(record, adbShell(`sqlite3 ${DB} "select value from catalystLocalStorage where key='${ACCESS_KEY}'"`), { mode: 0o600 });
      const changed = execFileSync('node', [path.join(E2E, 'tools', 'privateBalance.js'), state, ctx.seedFile, record], { encoding: 'utf8' })
        .trim().split('\n').pop();
      const sql = path.join(stateDir, 'record.sql');
      fs.writeFileSync(sql, `UPDATE catalystLocalStorage SET value='${changed.replace(/'/g, "''")}' WHERE key='${ACCESS_KEY}';\n`, { mode: 0o600 });
      execFileSync(ADB, ['push', '-q', sql, '/data/local/tmp/e2e-record.sql'], { stdio: 'ignore' });
      adbShell(`sqlite3 ${DB} < /data/local/tmp/e2e-record.sql; rm /data/local/tmp/e2e-record.sql`);
    });
    await step('runner: start the app and enter the PIN (adb)', unlock);
    const result = await runWritten(flow, stateDir, 'flow.yaml', walletStart.buildStartedFlow(state));
    if (!result.ok) throw new Error(`the app did not start with the private balance ${state}: ${result.failed}`);
  });
}

/**
 * Starts the app and enters the PIN on its lock screen, which never goes idle: Maestro takes 30 to
 * 50 s over each key there, and uiautomator never answers. Maestro's hierarchy doesn't wait for
 * idle, so the keys' places come from one of those, and adb taps them.
 */
async function unlock() {
  launchApp();
  await typePin('the lock screen');
}

const launchApp = () => execFileSync(ADB, ['shell', 'monkey -p network.hathor.wallet -c android.intent.category.LAUNCHER 1'], { stdio: 'ignore' });

/** Types a PIN on the keypad on screen, which may never go idle (see unlock). */
async function typePin(where = 'the PIN screen', pin = PIN) {
  let keys = {};
  for (let i = 0; i < 10 && Object.keys(keys).length < 10; i += 1) {
    const { stdout } = spawnSync(MAESTRO, ['hierarchy'], { encoding: 'utf8', env: MAESTRO_ENV, maxBuffer: 64 * 1024 * 1024 });
    keys = numpadKeys(stdout, { top: true });
  }
  if (Object.keys(keys).length < 10) throw new Error(`${where} did not show`);
  for (const digit of pin) {
    execFileSync(ADB, ['shell', 'input', 'tap', ...keys[digit]]);
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
}

/**
 * Waits until Maestro's hierarchy, which doesn't wait for the screen to go idle, has a text that
 * `pattern` matches: for screens uiautomator can't read, such as the lock screen.
 */
async function hierarchyShows(pattern, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  let texts = [];
  while (Date.now() < end) {
    const { stdout } = spawnSync(MAESTRO, ['hierarchy'], { encoding: 'utf8', env: MAESTRO_ENV, maxBuffer: 64 * 1024 * 1024 });
    texts = [...(stdout || '').matchAll(/"text" : "((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
    if (texts.some((text) => pattern.test(text))) return texts;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  throw new Error(`waited ${seconds} s for ${pattern} (the screen had: ${texts.filter(Boolean).slice(0, 12).join(' | ')})`);
}

/** Writes the privnet into the stopped app's storage, as before onboarding (app-on-privnet.sh). */
function pointAtPrivnet(facade) {
  execFileSync(path.join(E2E, 'bin', 'app-on-privnet.sh'), [], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, WALLET_SERVICE: facade === 'wallet-service' ? '1' : '' },
  });
}

/** The keys the app keeps in its storage, read as root. */
const storageKeys = () => adbShell(`sqlite3 ${DB} "select key from catalystLocalStorage"`).split('\n').filter(Boolean);

const seedIn = (dir, name) => {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${walletTool('new-seed')}\n`, { mode: 0o600 });
  return file;
};

/**
 * A minter of tokens the payer holds, to pay the app with. The treasury keeps their authorities,
 * for the cleanup to melt them. The two are apart because the payer's private sends leave it
 * private HTR, which wallet-lib can't pay a fee token's creation with (ROADMAP "Findings").
 */
function treasuryMinter(dir, treasurySeed, payerSeed) {
  const file = path.join(dir, 'tokens.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
  const payer = walletTool('address', payerSeed);
  return (kind, name, symbol) => {
    const uid = walletTool('mint', payer, kind, name, symbol, '100000', treasurySeed);
    const minted = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify([...minted, { uid, kind, symbol }], null, 2));
    log(`treasury: minted ${symbol} ${uid}`);
    return { name, symbol, uid };
  };
}

/** Pays the app what the payments and history scenarios start from, and registers the tokens. */
async function prepareReceives(dir, ctx) {
  const treasurySeed = seedIn(dir, 'treasury.seed');
  const payerSeed = seedIn(dir, 'payer.seed');
  const mint = treasuryMinter(dir, treasurySeed, payerSeed);
  const tokens = { deposit: mint('deposit', 'E2E Deposit', 'E2ED'), fee: mint('fee', 'E2E Fee', 'E2EF') };
  Object.values(tokens).forEach(({ uid }) => walletTool('send', payerSeed, ctx.appAddress, uid, PAID_TOKENS, 'public'));
  await fund(ctx.appAddress, PAID_HTR);
  const importDir = path.join(dir, 'import-tokens');
  await chapter(ctx, { kind: 'setup', id: 'import-tokens', title: 'Setup: import the 2 tokens paid' }, importDir, async ({ flow }) => {
    const names = Object.values(tokens).map(({ name }) => name);
    const imported = await runWritten(flow, importDir, 'flow.yaml', walletStart.buildImportFlow(names));
    if (!imported.ok) throw new Error(`importing the tokens failed: ${imported.failed}`);
  });
  const paid = { '00': BigInt(PAID_HTR) * 100n };
  Object.values(tokens).forEach(({ uid }) => { paid[uid] = BigInt(PAID_TOKENS); });
  return {
    tokens,
    treasurySeed,
    payerSeed,
    peerSeed: seedIn(dir, 'peer.seed'),
    book: Object.fromEntries(Object.entries(paid)
      .map(([uid, units]) => [uid, { private: 0n, public: units }])),
    totals: paid,
  };
}

// What a kept wallet is, for a later run; bigints as strings.
const KEPT = ['appAddress', 'seedFile', 'treasurySeed', 'payerSeed', 'peerSeed', 'tokens', 'destinations', 'book', 'totals', 'locked'];
const asJson = (value) => JSON.stringify(value, (key, v) => (typeof v === 'bigint' ? `${v}n` : v), 1);
const fromJson = (text) => JSON.parse(text, (key, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));

// Actions whose wallets are made alike, so that one can go on with another's.
const KIND = {
  send: 'send',
  'create-token': 'bare',
  receive: 'bare',
  'receive-payment': 'paid',
  history: 'paid',
  'register-token': 'paid',
  'reset-import': 'paid',
  settings: 'paid',
  // A wallet with no transactions, which the scenario leaves in multi-address mode for good.
  'address-mode': 'bare',
};

function keepWallet(setup, state, dir, ctx, failed) {
  const wallet = {
    setup: setup.id, state, kind: KIND[ctx.action], action: ctx.action, failed, dir,
  };
  KEPT.forEach((field) => { wallet[field] = ctx[field]; });
  if (ctx.action === 'send') wallet.tokens = ctx.byKind;
  fs.writeFileSync(path.join(dir, 'wallet.json'), asJson(wallet), { mode: 0o600 });
}

/** The wallet the app holds from a run with --keep, when these scenarios can go on with it. */
function keptWallet(setup, state, ctx, plan) {
  const refuse = (why) => {
    log(`not reusing a wallet: ${why}`);
    return null;
  };
  let dir = '';
  try {
    dir = adbShell(`cat ${WALLET_MARK} 2>/dev/null`);
  } catch (e) { /* no mark */ }
  const file = path.join(dir, 'wallet.json');
  if (!dir || !fs.existsSync(file)) return refuse('the app holds none that a run kept');
  const wallet = fromJson(fs.readFileSync(file, 'utf8'));
  if (wallet.setup !== setup.id || wallet.state !== state) return refuse(`the app's is ${wallet.state}, on ${wallet.setup}`);
  if (wallet.kind !== KIND[ctx.action]) return refuse(`the app's was made for ${wallet.kind} scenarios`);
  // What an unlocked wallet holds is read again from its seed; what a locked one shows can't be.
  if (state !== 'unlocked' && (wallet.failed || wallet.action !== ctx.action)) return refuse('what the app should show of it isn\'t known');
  if (ctx.createdTokens) return refuse('created tokens need a fresh one');
  if (plan.some((p) => p.scenario.values.funding === 'zero-htr')) return refuse('a scenario needs a wallet with no HTR');
  if (ctx.action === 'send') {
    const tokenKey = tokenPlan(plan).keyOf;
    if (Object.values(tokenKey).some((key) => key.startsWith('own') || key.endsWith('Large'))) return refuse('a scenario needs a token of its own');
  }
  return wallet;
}

/** A wallet for the scenarios of one private balance state: a fresh one, or the app's. */
async function prepareGroup(setup, state, dir, ctx, plan) {
  const cleared = Object.fromEntries(KEPT.map((field) => [field, undefined]));
  Object.assign(ctx, cleared, { locked: 0, reusedWallet: false });
  const fresh = ['start-wallet', 'address-mode'].includes(ctx.action);
  const kept = ctx.reuse && !fresh ? keptWallet(setup, state, ctx, plan) : null;
  if (kept) {
    KEPT.forEach((field) => { ctx[field] = kept[field]; });
    ctx.walletDir = kept.dir;
    log(`reusing the app's wallet ${kept.appAddress}`);
    ctx.reusedWallet = true;
    if (state === 'unlocked' && KIND[ctx.action] === 'paid') {
      const held = fromJson(walletTool('balances', ctx.seedFile));
      ctx.book = { '00': { private: 0n, public: 0n }, ...held };
      ctx.totals = Object.fromEntries(Object.entries(ctx.book)
        .map(([uid, balance]) => [uid, balance.private + balance.public]));
    }
    if (ctx.action === 'send') {
      const tokenKey = tokenPlan(plan).keyOf;
      const bySymbol = { htr: HTR, deposit: kept.tokens.deposit, fee: kept.tokens.fee };
      ctx.byKind = kept.tokens;
      ctx.tokens = Object.fromEntries(Object.entries(tokenKey)
        .map(([id, key]) => [id, bySymbol[key]]));
    }
    await screenOf(ADB).home();
    return;
  }
  ctx.walletDir = dir;
  Object.assign(ctx, await onboard(setup, dir, ctx));
  if (ctx.action === 'send') {
    Object.assign(ctx, await prepareSends(dir, ctx, plan));
  } else if (KIND[ctx.action] === 'paid') {
    Object.assign(ctx, await prepareReceives(dir, ctx));
  }
  if (state !== 'unlocked' || ctx.action === 'start-wallet') await startInState(state, dir, ctx);
  adbShell(`echo '${dir}' > ${WALLET_MARK}`);
}

/**
 * The centre of the element with this testID, from uiautomator dumps: it waits up to 10 s for
 * the element to show, as a screen opens.
 */
async function centreOf(testID) {
  const pattern = new RegExp(`resource-id="${testID}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  for (let i = 0; i < 10; i += 1) {
    const xml = execFileSync(ADB, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf8' });
    const node = pattern.exec(xml);
    if (node) {
      const [x1, y1, x2, y2] = node.slice(1).map(Number);
      return [String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))];
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
  }
  throw new Error(`${testID} did not show`);
}

/**
 * The HTR the dashboard shows, in cents, once it is what `expected` wants. A payment the app
 * misses would make every "not enough HTR" scenario pass for the wrong reason.
 */
async function htrShown(expected) {
  let shown = null;
  for (let i = 0; i < 20; i += 1) {
    shown = htrOnDashboard(execFileSync(ADB, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf8' }));
    if (shown !== null && expected(shown)) return shown;
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
  }
  throw new Error(`the dashboard shows ${shown === null ? 'no HTR balance' : `${shown} cents of HTR`}, not what this scenario needs`);
}

/**
 * Empties the address the Send tab keeps from the last scenario. A flow can't do it reliably:
 * eraseText deletes only what's before the cursor, and a tap can land mid-way through a 3-line
 * shielded address. Ctrl+A then Delete clears it wherever the cursor is; Maestro sends neither.
 */
async function clearSendAddress() {
  const input = (...args) => execFileSync(ADB, ['shell', 'input', ...args]);
  input('tap', ...(await centreOf('tab-send')));
  input('tap', ...(await centreOf('send-address-input')));
  await sleep(1000); // Ctrl+A goes nowhere until the field has focus
  input('keycombination', '113', '29'); // Ctrl+A
  input('keyevent', '67'); // Delete
}

async function runCreateScenario(scenario, outcome, ctx, dir, { step, flow }) {
  const { values } = scenario;
  if (values.funding === 'enough-htr') {
    await step(`runner: pay the app wallet ${TOP_UP_HTR} HTR`, async () => {
      await fund(ctx.appAddress, TOP_UP_HTR);
      await sleep(6000); // the app picks the payment up over its websocket
    });
  }
  const id = path.basename(dir);
  const wanted = { name: `E2E Created ${id}`, symbol: `EC${id}` };
  const flowFile = path.join(dir, 'flow.yaml');
  const { pinUrl } = ctx;
  const yaml = createTokenFlow.buildCreateTokenFlow(scenario, outcome, { ...wanted, pinUrl });
  fs.writeFileSync(flowFile, yaml);
  let { ok, notes } = await runToOutcome(flow, flowFile, dir, outcome, ctx);
  if (ok && outcome.kind === 'success') {
    const token = await createdToken(dir);
    ok = token.name === wanted.name && token.symbol === wanted.symbol && token.total > 0n;
    notes += `; on chain: ${token.name} (${token.symbol}), ${token.total} units, version ${token.version}`;
  }
  return { status: ok ? 'passed' : 'failed', notes };
}

/** The group's setup started the wallet; this reads which facade it ended on. */
async function runStartScenario(scenario, outcome, dir, { flow }) {
  const facade = flows.facadeOf(scenario, outcome);
  const result = await runWritten(flow, dir, 'flow.yaml', walletStart.buildServerFlow(facade));
  // The app's own mark of a fallback, so that each outcome has a second witness.
  const ignored = adbShell(`sqlite3 ${DB} "select count(*) from catalystLocalStorage where key='featureFlags:ignoreWalletServiceFlag'"`) === '1';
  const ok = result.ok && ignored === (outcome.id === 'edge-fallback');
  return {
    status: ok ? 'passed' : 'failed',
    notes: `${result.ok ? `on the ${facade}` : result.failed}; the app ${ignored ? 'ignores' : 'does not ignore'} the wallet service`,
  };
}

// The scenarios the runner drives over adb (lib/screen.js).
const BY_ADB = {
  receive: (scenario, outcome, ctx, dir, api) => runReceive(scenario, ctx, dir, api),
  'receive-payment': runPayment,
  history: runHistory,
  'register-token': runRegister,
  'reset-import': runResetImport,
  settings: runSettings,
  'address-mode': runAddressMode,
};

async function runByAdb(scenario, outcome, ctx, dir, api) {
  const screen = screenOf(ADB);
  let result;
  try {
    const notes = await BY_ADB[scenario.action](scenario, outcome, ctx, dir, { ...api, screen });
    result = { status: 'passed', notes: `reached: ${outcome.id}; ${notes}` };
  } catch (e) {
    fs.writeFileSync(path.join(dir, 'failure.png'), screen.screenshot());
    fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify(screen.nodes(), null, 1));
    result = { status: 'failed', notes: e.message };
  }
  try {
    await api.step(BACK, () => screen.home());
  } catch (e) {
    result.notes += `; ${e.message}`;
  }
  return result;
}

async function runScenario(scenario, outcome, ctx, dir, api) {
  if (scenario.action === 'create-token') return runCreateScenario(scenario, outcome, ctx, dir, api);
  if (scenario.action === 'start-wallet') return runStartScenario(scenario, outcome, dir, api);
  if (BY_ADB[scenario.action]) return runByAdb(scenario, outcome, ctx, dir, api);
  const { step, flow } = api;
  const { values } = scenario;
  if (values.funding === 'enough-htr') {
    await step(`runner: pay the app wallet ${TOP_UP_HTR} HTR, and wait until it shows`, async () => {
      const had = await htrShown(() => true);
      await fund(ctx.appAddress, TOP_UP_HTR);
      await htrShown((cents) => cents === had + BigInt(TOP_UP_HTR) * 100n);
    });
  } else {
    await step('runner: check that the app shows no HTR', () => htrShown((cents) => cents === 0n));
  }
  const address = ctx.destinations[values.dest];
  const token = ctx.tokens[scenario.id];
  const before = values.dest !== 'shielded' ? await receivedBy(address, token.uid) : null;
  const flowFile = path.join(dir, 'flow.yaml');
  const { pinUrl } = ctx;
  fs.writeFileSync(flowFile, sendFlow.buildSendFlow(scenario, outcome, { address, token, pinUrl }));
  await step('runner: empty the Send tab\'s address field (adb)', clearSendAddress);
  let { ok, notes } = await runToOutcome(flow, flowFile, dir, outcome, ctx);
  if (ok && outcome.kind === 'success' && before !== null) {
    const landed = (await receivedBy(address, token.uid)) > before;
    ok = landed;
    notes += landed ? '; the destination received it' : '; but the destination received nothing';
  }
  return { status: ok ? 'passed' : 'failed', notes };
}

/** Which build of the app the emulator has: debug or release, its version, when installed. */
function appBuild(toolsCommit) {
  const info = execFileSync(ADB, ['shell', 'dumpsys', 'package', 'network.hathor.wallet'], { encoding: 'utf8' });
  const field = (name) => ((new RegExp(`${name}=(\\S+)`).exec(info) || [])[1] || '?');
  const installed = (/lastUpdateTime=([\d-]+ [\d:]+)/.exec(info) || [])[1] || '?';
  // A debug build takes its JS from Metro, which serves the checkout at hand.
  if (/flags=\[[^\]]*DEBUGGABLE/.test(info)) return `debug build ${field('versionName')}, JS from Metro at ${toolsCommit}`;
  return `release build ${field('versionName')}, installed ${installed}`;
}

function writeResults(setupId, results, startedAt, ctx) {
  const graphFile = 'QA/graph/graph.yaml';
  const yamlCommit = git('log', '-1', '--format=%h', '--', graphFile);
  const yamlDate = git('log', '-1', '--format=%cs', '--', graphFile);
  const toolsCommit = git('rev-parse', '--short', 'HEAD');
  const dirty = git('status', '--porcelain', '--', 'QA') ? ' (with uncommitted changes)' : '';
  const doc = {
    yamlCommit,
    yamlDate,
    toolsCommit: `${toolsCommit}${dirty}`,
    appBuild: appBuild(`${toolsCommit}${dirty}`),
    device: 'Android emulator (AVD hnni, android-36 x86_64)',
    platform: 'android',
    environment: 'local-privnet',
    scope: { reason: `e2e runner: ${ctx.action} scenarios of ${setupId}${ctx.createdTokens ? ', with tokens created in the app' : ''}${ctx.unlocked ? ', unlocked private balance only' : ''}${ctx.subset ? `, only ${ctx.subset}` : ''}`, picks: ctx.picks.map((pick) => pick.id) },
    results,
  };
  const resultsDir = ctx.resultsDir || path.join(REPO, 'QA', 'graph', 'runs');
  fs.mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `${startedAt.slice(0, 19).replace(/[:T]/g, '-')}-${setupId}-${ctx.action}${ctx.createdTokens ? '-created-tokens' : ''}.yaml`);
  const header = `# This test was run based on the YAML of ${yamlDate}, version from commit ${yamlCommit}, `
    + `with the tools at commit ${toolsCommit}${dirty}.\n`;
  fs.writeFileSync(file, header + YAML.stringify(doc));
  return file;
}

/** What --affected and --since pick, and the ids of the scenarios they reach, or null for all. */
function affectedBy(args, graph, scenarios) {
  const picks = (args.affected || []).map((name) => pickOf(graph, name));
  if (args.since) {
    const files = [
      git('diff', '--name-only', git('merge-base', args.since, 'HEAD')),
      git('ls-files', '--others', '--exclude-standard'),
    ].flatMap((list) => list.split('\n')).filter(Boolean);
    const changed = picksOfFiles(graph, files);
    picks.push(...changed.picks);
    if (changed.unlisted.length) {
      log(`no feature of the graph lists these changed files; what they reach is not in this run:\n  ${changed.unlisted.join('\n  ')}`);
    }
  }
  if (!args.affected && !args.since) return { picks, affected: null };
  log(`picked: ${picks.map((pick) => pick.id).join(', ') || 'nothing'}`);
  return { picks, affected: affectedIds(graph, picks, scenarios) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const graph = loadGraph(path.join(REPO, 'QA', 'graph', 'graph.yaml'));
  const setup = graph.setups.find((s) => s.id === args.setup);
  if (!setup) throw new Error(`unknown setup ${args.setup}`);
  if (!flows.ACTIONS.includes(args.action)) throw new Error(`the kit can't run the action ${args.action}; it runs ${flows.ACTIONS.join(', ')}`);
  const everything = planScenarios(graph, { ...args, setup: setup.id });
  const all = everything.map((p) => p.scenario);
  const unknown = (args.scenarios || []).filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) throw new Error(`no such scenario here: ${unknown.join(', ')}`);
  const { picks, affected } = affectedBy(args, graph, all);
  const plan = everything
    .filter(({ scenario: { id } }) => !args.scenarios || args.scenarios.includes(id))
    .filter(({ scenario: { id } }) => !affected || affected.has(id));
  log(`${plan.length} of ${all.length} scenarios, ${plan.filter((p) => !p.skip).length} runnable`);
  if (args.dryRun) {
    plan.forEach((p) => {
      console.log(`${p.skip ? 'skip' : 'run '}  ${p.scenario.id}  ${p.skip || `-> ${p.outcome.id}`}`);
    });
    return;
  }

  if (!plan.length) return;
  await preflight(setup);
  // The code as it is now, at the start: what the results are of.
  const index = workIndex(REPO);
  const stale = staleApp(appId(index));
  if (stale) log(`WARNING: ${stale}`);
  const ids = checkoutIds(index, graph, flows.ACTION_FILES);
  const reach = reachOf(graph, all);
  // An app of other sources says nothing of these: such results don't count as passes of them.
  const current = (p) => ({
    ...currentOf({ ...p, flow: flows.digest(flows.flowOf(p.scenario, p.outcome)) }, ids, reach),
    ...(stale ? { status: 'stale app' } : {}),
    ...(args.reuse ? { reused: true } : {}),
  });
  const runDir = path.join(E2E, 'evidence', startedAt.slice(0, 19).replace(/[:T]/g, '-'));
  fs.mkdirSync(runDir, { recursive: true });
  await runPlan(setup, plan, runDir, startedAt, {
    ...args, picks, ids, current,
  });
  log('when done: tear down the emulator and the privnet, and Metro if a debug build ran (README)');
}

function cleanUp(dir, args) {
  if (!fs.existsSync(path.join(dir, 'treasury.seed'))) return;
  if (args.noCleanup) {
    log(`cleanup skipped; later: node QA/e2e/tools/wallet.js cleanup ${path.relative(REPO, dir)}`);
    return;
  }
  log('cleanup: giving the wallet\'s HTR and deposits back to genesis');
  try {
    execFileSync('node', [path.join(E2E, 'tools', 'wallet.js'), 'cleanup', dir], { encoding: 'utf8' })
      .split('\n').filter((line) => line.startsWith('cleanup: '))
      .forEach((line) => log(line));
  } catch (e) {
    log(`cleanup failed (${e.message.split('\n')[0]}); retry: node QA/e2e/tools/wallet.js cleanup ${path.relative(REPO, dir)}`);
  }
}

/** Runs the scenarios of one private balance state on a fresh wallet. */
async function runGroup(setup, state, plan, ctx, args, record, lastGroup) {
  const dir = path.join(ctx.runDir, state);
  fs.mkdirSync(dir, { recursive: true });
  log(`private balance ${state}: ${plan.length} scenarios`);
  const results = [];
  let broken = null;
  report('setup-started', { wallet: state });
  try {
    await prepareGroup(setup, state, dir, ctx, plan.filter((p) => !p.skip));
    report('setup-finished', { wallet: state, reused: ctx.reusedWallet });
  } catch (e) {
    broken = `setup failed: ${e.message}`;
    log(broken);
    report('setup-finished', { wallet: state, error: e.message });
  }
  for (const [i, p] of plan.entries()) {
    const info = {
      kind: 'scenario',
      id: p.scenario.id,
      title: p.scenario.id.split(':').pop(),
      values: p.scenario.values,
      expected: p.outcome && { id: p.outcome.id, message: p.outcome.message },
    };
    if (p.skip || broken) {
      const status = p.skip ? 'skipped' : 'failed';
      results.push({ scenario: p.scenario.id, status, notes: p.skip || broken });
      ctx.chapters.push({ ...info, status, notes: p.skip || broken });
      report('scenario-not-run', { scenario: p.scenario.id, status: p.skip ? 'skipped' : 'did not run', note: p.skip || broken });
      // eslint-disable-next-line no-continue
      continue;
    }
    info.flowVersion = flowVersion(p.scenario, p.outcome, ctx.action === 'send' && ctx.tokens ? ctx.tokens[p.scenario.id] : undefined, ctx.ids);
    const scenarioDir = path.join(dir, 'scenarios', String(i + 1).padStart(2, '0'));
    log(`run  ${p.scenario.id} -> ${p.outcome.id}`);
    report('scenario-started', { scenario: p.scenario.id });
    const scenarioStart = Date.now();
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await chapter(ctx, info, scenarioDir, (api) => (
        runScenario(p.scenario, p.outcome, ctx, scenarioDir, api)));
    } catch (e) {
      result = { status: 'failed', notes: `runner error: ${e.message}` };
    }
    log(`     ${result.status}: ${result.notes}`);
    report('scenario-finished', { scenario: p.scenario.id, status: result.status, note: result.notes });
    ledger.record(keyOf(p.scenario, ctx.createdTokens), {
      status: result.status,
      at: new Date().toISOString(),
      seconds: Math.round((Date.now() - scenarioStart) / 1000),
      ...ctx.current(p),
    });
    results.push({ scenario: p.scenario.id, status: result.status, notes: result.notes });
  }
  if (record) writeViewer(ctx);
  report('step', { text: 'giving the wallet\'s funds back, or keeping the wallet for the next job' });
  // The app holds one wallet, so only the last group's can be kept.
  if (args.keep && !broken && lastGroup) keepWallet(setup, state, ctx.walletDir, ctx, results.some(({ status }) => status === 'failed'));
  else cleanUp(ctx.walletDir || dir, args);
  return results;
}

async function runPlan(setup, plan, runDir, startedAt, args) {
  const record = !args.noRecord;
  const runInfo = {
    setup: setup.id, startedAt, toolsCommit: git('rev-parse', '--short', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  };
  const ctx = {
    record,
    runDir,
    runInfo,
    chapters: [],
    action: args.action,
    createdTokens: args.createdTokens,
    unlocked: args.unlocked,
    picks: args.picks,
    reuse: args.reuse,
    resultsDir: args.results,
    ids: args.ids,
    current: args.current,
    // For the scenarios driven over adb.
    walletTool,
    adbShell,
    clearSendAddress,
    unlock,
    launchApp,
    typePin,
    hierarchyShows,
    unleashUserId: async () => (await getJson(`${UNLEASH_URL}/flags`)).userId,
    versionOfApp: () => {
      const info = execFileSync(ADB, ['shell', 'dumpsys', 'package', 'network.hathor.wallet'], { encoding: 'utf8' });
      return { name: /versionName=(\S+)/.exec(info)[1], code: /versionCode=(\d+)/.exec(info)[1] };
    },
    pointAtPrivnet,
    storageKeys,
    // What --reuse goes by: a reset drops it until the wallet is back.
    forgetWallet: () => adbShell(`rm -f ${WALLET_MARK}`),
    markWallet: () => adbShell(`echo '${ctx.walletDir}' > ${WALLET_MARK}`),
    fund,
    transaction: async (id) => (await getJson(`${NODE_URL}transaction?id=${id}`)).tx,
    tokenOnChain: (uid) => getJson(`${NODE_URL}thin_wallet/token?id=${uid}`),
    mintForPayer: (...token) => (
      treasuryMinter(path.dirname(ctx.seedFile), ctx.treasurySeed, ctx.payerSeed)(...token)),
    subset: [args.scenarios && 'the scenarios named', (args.affected || args.since) && 'what the picks reach'].filter(Boolean).join(', of those '),
  };
  if (record) report('viewer', { viewer: `${path.basename(runDir)}/viewer.html` });
  const pinServer = await startPinServer(ADB, PIN, () => ctx.pinKeys);
  ctx.pinServer = pinServer;
  const results = [];
  for (const state of STATES) {
    const group = plan.filter((p) => p.scenario.values['private-balance'] === state);
    const lastGroup = STATES.slice(STATES.indexOf(state) + 1)
      .every((other) => !plan.some((p) => p.scenario.values['private-balance'] === other));
    if (group.length) {
      // eslint-disable-next-line no-await-in-loop
      results.push(...await runGroup(setup, state, group, ctx, args, record, lastGroup));
    }
  }
  pinServer.close();
  const file = writeResults(setup.id, results, startedAt, ctx);
  const count = (status) => results.filter((result) => result.status === status).length;
  log(`passed ${count('passed')}, failed ${count('failed')}, skipped ${count('skipped')}`);
  log(`results: ${path.relative(REPO, file)}; evidence: ${path.relative(REPO, runDir)}`);
  if (record) log(`viewer: ${path.relative(REPO, path.join(runDir, 'viewer.html'))}`);
}

main().catch((e) => {
  console.error(`run: ${e.message}`);
  process.exit(1);
});
