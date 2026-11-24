#!/usr/bin/env node
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Runs the QA graph's send scenarios of one setup on the emulator, against the local privnet,
// and writes one results file in QA/graph/runs/.
//
//   node QA/e2e/run.js --setup pn-fn-seed-multi [--scenarios <id>,<id>] [--dry-run] [--no-cleanup]
//                      [--no-record] [--action send|create-token] [--unlocked] [--created-tokens]
//
// --unlocked picks scenarios as if an unlocked private balance were the only one, so the cover
// isn't spent on the states the kit can't set up. --created-tokens (send only, implies --unlocked)
// sends only custom tokens, made in the app by the run instead of minted from outside.
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

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
// eslint-disable-next-line import/no-extraneous-dependencies
const YAML = require('yaml');
const { loadGraph } = require('../graph/tools/load');
const { allScenarios } = require('../graph/tools/scenarios');
const { assertEmulator } = require('./lib/device');
const sendFlow = require('./lib/sendFlow');
const createTokenFlow = require('./lib/createTokenFlow');
const { runOrder } = require('./lib/runOrder');
const { htrOnDashboard } = require('./lib/dashboard');
const { startRecording } = require('./lib/recorder');
const { entriesFrom, runnerEntry, skipRanges } = require('./lib/timeline');

const E2E = __dirname;
const REPO = path.resolve(E2E, '..', '..');
const ADB = process.env.ADB || path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const MAESTRO = process.env.MAESTRO || path.join(os.homedir(), '.maestro/maestro/bin/maestro');
const NODE_URL = 'http://localhost:18083/v1a/';
const FUNDING_URL = 'http://localhost:13020';
const UNLEASH_URL = 'http://localhost:18042';
const WALLET_SERVICE_URL = 'http://localhost:18300/dev/';
const TOP_UP_HTR = '20';
// The custom tokens minted for the app wallet, by the graph's token value. Deposit sends of 2^40
// units use their own token holding exactly that, so other deposit sends see an ordinary balance
// (a balance above 2^40 makes a private "max" send fail the 2^40 limit before the fee check).
const TOKENS = {
  htr: { name: 'Hathor', symbol: 'HTR', uid: '00' },
  deposit: { kind: 'deposit', name: 'E2E Deposit', symbol: 'E2ED', units: '100000' },
  depositLarge: { kind: 'deposit', name: 'E2E Large', symbol: 'E2EL', units: String(2 ** 40) },
  fee: { kind: 'fee', name: 'E2E Fee', symbol: 'E2EF', units: '100000' },
};

/** The key in TOKENS of the token a scenario sends. */
const tokenFor = ({ token, amount }) => (
  token === 'deposit' && amount === 'private-over-limit' ? 'depositLarge' : token);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

function parseArgs(argv) {
  const args = { action: 'send' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--setup') args.setup = argv[i += 1];
    else if (argv[i] === '--action') args.action = argv[i += 1];
    else if (argv[i] === '--unlocked') args.unlocked = true;
    else if (argv[i] === '--created-tokens') args.createdTokens = true;
    else if (argv[i] === '--scenarios') args.scenarios = argv[i += 1].split(',');
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--no-cleanup') args.noCleanup = true;
    else if (argv[i] === '--no-record') args.noRecord = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.setup) {
    throw new Error('usage: run.js --setup <setup id> [--action send|create-token] [--unlocked] [--created-tokens] [--scenarios <id>,<id>] [--dry-run] [--no-cleanup] [--no-record]');
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

function maestro(flow, outDir, retries = 1) {
  const result = spawnSync(MAESTRO, ['test', `--test-output-dir=${outDir}`, `--debug-output=${outDir}`, flow], {
    encoding: 'utf8',
    env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64' },
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
      throw new Error(`${name} is not available (${e.message}); see QA/e2e/README.md "Run"`);
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
  await getJson(`${FUNDING_URL}/fund`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, amount: cents }),
  });
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
      const start = Date.now();
      try {
        return await fn();
      } finally {
        parts.push({ start, end: Date.now(), text });
      }
    },
    flow(file, outDir, as) {
      const start = Date.now();
      const result = maestro(file, outDir);
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
<style>body{font:15px system-ui;margin:2em;background:#111;color:#eee}a{color:#8cf}</style><h1>e2e runs</h1><ul>${items}</ul>`);
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
async function createInApp(appAddress, kind, { name, symbol }, dir, { step, flow }) {
  const cost = kind === 'deposit' ? '10' : '0.01';
  await step(`runner: pay the app wallet ${cost} HTR, what ${symbol} costs`, async () => {
    await fund(appAddress, cost);
    await sleep(6000);
  });
  const scenario = { id: `setup: create ${symbol}`, values: { token: kind, naming: 'valid', 'mint-amount': 'thousand' } };
  const flowFile = path.join(dir, 'flow.yaml');
  fs.mkdirSync(dir, { recursive: true });
  const yaml = createTokenFlow.buildCreateTokenFlow(scenario, CREATED, { name, symbol });
  fs.writeFileSync(flowFile, yaml);
  fs.copyFileSync(path.join(E2E, 'flows', 'enter_pin.yaml'), path.join(dir, '..', 'enter_pin.yaml'));
  const result = flow(flowFile, dir, `setup: create ${symbol} in the app`);
  if (!result.ok) throw new Error(`creating ${symbol} failed: ${result.failed}`);
  const token = await createdToken(dir);
  flow(path.join(E2E, 'flows', 'to_dashboard.yaml'), path.join(dir, 'reset'), 'runner: back to the dashboard');
  return { name, symbol, uid: token.uid };
}

async function createTokensInApp(ctx, runDir, appAddress, tokens) {
  for (const key of ['deposit', 'fee']) {
    const dir = path.join(runDir, `create-${key}`);
    const info = { kind: 'setup', id: `create-${key}`, title: `Setup: create ${TOKENS[key].symbol} in the app` };
    // eslint-disable-next-line no-await-in-loop
    await chapter(ctx, info, dir, async (api) => {
      // eslint-disable-next-line no-param-reassign
      tokens[key] = await createInApp(appAddress, key, TOKENS[key], path.join(dir, 'flow'), api);
    });
    log(`app: created ${tokens[key].symbol} ${tokens[key].uid}`);
  }
}

/** A digest of the flow a scenario runs, the same in every run while the flow is: the viewer
 * uses it to tell which scenarios changed since someone watched them. */
function flowVersion(scenario, outcome, token) {
  const flow = scenario.action === 'create-token'
    ? createTokenFlow.buildCreateTokenFlow(scenario, outcome, { name: '<name>', symbol: '<symbol>' })
    : sendFlow.buildSendFlow(scenario, outcome, { address: '<address>', token });
  return crypto.createHash('sha1').update(flow).digest('hex').slice(0, 12);
}

async function prepareSetup(setup, runDir, ctx) {
  const onWalletService = setup.values.facade === 'wallet-service';
  const flags = { 'wallet-service-mobile.rollout': onWalletService };
  if (setup.values['flag-fbt']) flags['fee-based-tokens.rollout'] = setup.values['flag-fbt'] === 'on';
  await getJson(`${UNLEASH_URL}/flags`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flags),
  });
  log('app: fresh install on the privnet');
  execFileSync(path.join(E2E, 'bin', 'app-on-privnet.sh'), ['--fresh'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, WALLET_SERVICE: onWalletService ? '1' : '' },
  });
  const onboardDir = path.join(runDir, 'onboard');
  const onboardInfo = { kind: 'setup', id: 'onboard', title: 'Onboarding: a new wallet on the privnet' };
  // Not recorded: its screen shows the seed, and the viewer and recordings are made to be shared.
  await chapter({ ...ctx, record: false }, onboardInfo, onboardDir, async ({ flow }) => {
    const onboard = flow(path.join(E2E, 'flows', 'onboard.yaml'), onboardDir);
    if (!onboard.ok) throw new Error(`onboarding failed: ${onboard.failed}`);
  });
  const seed = findFiles(onboardDir, 'maestro.log')
    .map((file) => (fs.readFileSync(file, 'utf8').match(/JsConsole: E2E_SEED ([a-z ]+)/) || [])[1])
    .find(Boolean);
  if (!seed || seed.trim().split(' ').length !== 24) throw new Error('could not read the wallet seed from onboarding');
  const seedFile = path.join(runDir, 'app.seed');
  fs.writeFileSync(seedFile, `${seed.trim()}\n`, { mode: 0o600 });
  const appAddress = walletTool('address', seedFile);
  log(`app: wallet ${appAddress}`);

  if (onWalletService) {
    const checkDir = path.join(runDir, 'check-wallet-service');
    const checkInfo = { kind: 'setup', id: 'check-wallet-service', title: 'Setup: the app is on the wallet service' };
    await chapter(ctx, checkInfo, checkDir, async ({ flow }) => {
      const check = flow(path.join(E2E, 'flows', 'check_wallet_service.yaml'), checkDir);
      if (!check.ok) throw new Error(`the app is not on the wallet service: ${check.failed}`);
    });
  }
  if (ctx.action === 'create-token') return { appAddress };

  // The treasury keeps the tokens' authorities, so the cleanup can melt them; tokens.json tells
  // the cleanup what was minted, even when the run stops half-way.
  const treasurySeed = path.join(runDir, 'treasury.seed');
  fs.writeFileSync(treasurySeed, `${walletTool('new-seed')}\n`, { mode: 0o600 });
  const tokens = { htr: TOKENS.htr };
  const minted = [];
  if (ctx.createdTokens) {
    fs.writeFileSync(path.join(runDir, 'tokens.json'), '[]');
    await createTokensInApp(ctx, runDir, appAddress, tokens);
  }
  for (const key of ctx.createdTokens ? [] : ['deposit', 'depositLarge', 'fee']) {
    const { kind, name, symbol, units } = TOKENS[key];
    tokens[key] = { name, symbol, uid: walletTool('mint', appAddress, kind, name, symbol, units, treasurySeed) };
    minted.push({ uid: tokens[key].uid, kind, symbol });
    fs.writeFileSync(path.join(runDir, 'tokens.json'), JSON.stringify(minted, null, 2));
    log(`app: minted ${symbol} ${tokens[key].uid}`);
  }
  if (!ctx.createdTokens) {
    const importDir = path.join(runDir, 'import-tokens');
    const importInfo = { kind: 'setup', id: 'import-tokens', title: 'Setup: import the minted E2ED, E2EL and E2EF' };
    await chapter(ctx, importInfo, importDir, async ({ flow }) => {
      const imported = flow(path.join(E2E, 'flows', 'import_tokens.yaml'), importDir);
      if (!imported.ok) throw new Error(`importing the minted tokens failed: ${imported.failed}`);
    });
  }

  const peerSeed = path.join(runDir, 'peer.seed');
  fs.writeFileSync(peerSeed, `${walletTool('new-seed')}\n`, { mode: 0o600 });
  // Both single-key destinations are the peer's, a seed the runner holds, so the cleanup can give
  // back what they received; the multisig's keys stay with the helper.
  const destinations = {
    simple: walletTool('address', peerSeed),
    multisig: (await getJson(`${FUNDING_URL}/multisigWallet?participants=3&numSignatures=2`)).wallets[0].addresses[0],
    shielded: walletTool('shielded-address', peerSeed),
  };
  log(`destinations: ${JSON.stringify(destinations)}`);
  return { appAddress, destinations, tokens };
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
  fs.writeFileSync(flowFile, createTokenFlow.buildCreateTokenFlow(scenario, outcome, wanted));
  fs.copyFileSync(path.join(E2E, 'flows', 'enter_pin.yaml'), path.join(dir, '..', 'enter_pin.yaml'));
  const result = flow(flowFile, dir);
  let { ok } = result;
  let notes = ok ? `reached: ${outcome.id}` : `${result.failed || 'flow failed'}`;
  if (ok && outcome.kind === 'success') {
    const token = await createdToken(dir);
    ok = token.name === wanted.name && token.symbol === wanted.symbol && token.total > 0n;
    notes += `; on chain: ${token.name} (${token.symbol}), ${token.total} units, version ${token.version}`;
  }
  const back = flow(path.join(E2E, 'flows', 'to_dashboard.yaml'), path.join(dir, 'reset'), 'runner: back to the dashboard for the next scenario');
  if (!back.ok) notes += '; could not return to the dashboard';
  return { status: ok ? 'passed' : 'failed', notes };
}

async function runScenario(scenario, outcome, ctx, dir, api) {
  if (scenario.action === 'create-token') return runCreateScenario(scenario, outcome, ctx, dir, api);
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
  let token = ctx.tokens[tokenFor(values)];
  if (ctx.createdTokens && values.amount === 'max') {
    // A max send empties the token, so it gets one of its own.
    const n = path.basename(dir);
    token = await createInApp(ctx.appAddress, values.token, { name: `E2E Max ${n}`, symbol: `EM${n}` }, path.join(dir, 'create'), api);
  }
  const before = values.dest !== 'shielded' ? await receivedBy(address, token.uid) : null;
  const flowFile = path.join(dir, 'flow.yaml');
  fs.writeFileSync(flowFile, sendFlow.buildSendFlow(scenario, outcome, { address, token }));
  // The generated flow refers to ../enter_pin.yaml; keep a copy of the sub-flows beside it.
  fs.copyFileSync(path.join(E2E, 'flows', 'enter_pin.yaml'), path.join(dir, '..', 'enter_pin.yaml'));
  await step('runner: empty the Send tab\'s address field (adb)', clearSendAddress);
  const result = flow(flowFile, dir);
  let notes = result.ok ? `reached: ${outcome.id}` : `${result.failed || 'flow failed'}`;
  let { ok } = result;
  if (ok && outcome.kind === 'success' && before !== null) {
    const landed = (await receivedBy(address, token.uid)) > before;
    ok = landed;
    notes += landed ? '; the destination received it' : '; but the destination received nothing';
  }
  const back = flow(path.join(E2E, 'flows', 'to_dashboard.yaml'), path.join(dir, 'reset'), 'runner: back to the dashboard for the next scenario');
  if (!back.ok) notes += '; could not return to the dashboard';
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
    scope: { reason: `e2e runner: ${ctx.action} scenarios of ${setupId}${ctx.createdTokens ? ', with tokens created in the app' : ''}${ctx.unlocked ? ', unlocked private balance only' : ''}`, picks: [] },
    results,
  };
  const file = path.join(REPO, 'QA', 'graph', 'runs', `${startedAt.slice(0, 19).replace(/[:T]/g, '-')}-${setupId}-${ctx.action}${ctx.createdTokens ? '-created-tokens' : ''}.yaml`);
  const header = `# This test was run based on the YAML of ${yamlDate}, version from commit ${yamlCommit}, `
    + `with the tools at commit ${toolsCommit}${dirty}.\n`;
  fs.writeFileSync(file, header + YAML.stringify(doc));
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const graph = loadGraph(path.join(REPO, 'QA', 'graph', 'graph.yaml'));
  const setup = graph.setups.find((s) => s.id === args.setup);
  if (!setup) throw new Error(`unknown setup ${args.setup}`);
  const action = graph.actions.find((a) => a.id === args.action);
  const outcomes = Object.fromEntries(action.path.outcomes.map((o) => [o.id, o]));
  if (!action || !['send', 'create-token'].includes(action.id)) throw new Error(`the kit can't run the action ${args.action}`);
  const { unrunnableReason } = action.id === 'send' ? sendFlow : createTokenFlow;
  const only = {};
  if (args.unlocked || args.createdTokens) only['private-balance'] = ['unlocked'];
  if (args.createdTokens) {
    only.token = ['deposit', 'fee'];
    // 2^40 units need a deposit of 110M HTR; the minted tokens cover that amount.
    only.amount = ['normal', 'max', 'over-balance', 'empty', 'decimals'];
  }
  const picked = {
    ...graph,
    axes: graph.axes.map((axis) => (only[axis.id]
      ? { ...axis, values: axis.values.filter((v) => only[axis.id].includes(v.id)) } : axis)),
  };
  const scenarios = allScenarios(picked)
    .filter((s) => s.setup === setup.id && s.action === action.id)
    .filter((s) => !args.scenarios || args.scenarios.includes(s.id));

  const plan = runOrder(scenarios.map((s) => ({
    scenario: s, skip: unrunnableReason(s), outcome: outcomes[s.expected[0]],
  })));
  log(`${plan.length} scenarios, ${plan.filter((p) => !p.skip).length} runnable`);
  if (args.dryRun) {
    plan.forEach((p) => {
      console.log(`${p.skip ? 'skip' : 'run '}  ${p.scenario.id}  ${p.skip || `-> ${p.outcome.id}`}`);
    });
    return;
  }

  await preflight(setup);
  const runDir = path.join(E2E, 'evidence', startedAt.slice(0, 19).replace(/[:T]/g, '-'));
  fs.mkdirSync(runDir, { recursive: true });
  try {
    await runPlan(setup, plan, runDir, startedAt, args);
  } finally {
    if (args.noCleanup) {
      log(`cleanup skipped; later: node QA/e2e/tools/wallet.js cleanup ${path.relative(REPO, runDir)}`);
    } else if (fs.existsSync(path.join(runDir, 'treasury.seed'))) {
      log('cleanup: giving the run\'s HTR and deposits back to genesis');
      try {
        execFileSync('node', [path.join(E2E, 'tools', 'wallet.js'), 'cleanup', runDir], { encoding: 'utf8' })
          .split('\n').filter((line) => line.startsWith('cleanup: '))
          .forEach((line) => log(line));
      } catch (e) {
        log(`cleanup failed (${e.message.split('\n')[0]}); retry: node QA/e2e/tools/wallet.js cleanup ${path.relative(REPO, runDir)}`);
      }
    }
  }
  log('when done: tear down the emulator and the privnet, and Metro if a debug build ran (README)');
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
    unlocked: args.unlocked || args.createdTokens,
  };
  Object.assign(ctx, await prepareSetup(setup, runDir, ctx));
  const results = [];
  for (const [i, p] of plan.entries()) {
    const info = {
      kind: 'scenario',
      id: p.scenario.id,
      title: p.scenario.id.split(':').pop(),
      values: p.scenario.values,
      expected: p.outcome && { id: p.outcome.id, message: p.outcome.message },
    };
    if (p.skip) {
      results.push({ scenario: p.scenario.id, status: 'skipped', notes: p.skip });
      ctx.chapters.push({ ...info, status: 'skipped', notes: p.skip });
      // eslint-disable-next-line no-continue
      continue;
    }
    const token = ctx.tokens && ctx.tokens[tokenFor(p.scenario.values)];
    info.flowVersion = flowVersion(p.scenario, p.outcome, token);
    const dir = path.join(runDir, 'scenarios', String(i + 1).padStart(2, '0'));
    log(`run  ${p.scenario.id} -> ${p.outcome.id}`);
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await chapter(ctx, info, dir, (api) => (
        runScenario(p.scenario, p.outcome, ctx, dir, api)));
    } catch (e) {
      result = { status: 'failed', notes: `runner error: ${e.message}` };
    }
    log(`     ${result.status}: ${result.notes}`);
    results.push({ scenario: p.scenario.id, status: result.status, notes: result.notes });
  }
  const file = writeResults(setup.id, results, startedAt, ctx);
  const count = (status) => results.filter((r) => r.status === status).length;
  log(`passed ${count('passed')}, failed ${count('failed')}, skipped ${count('skipped')}`);
  log(`results: ${path.relative(REPO, file)}; evidence: ${path.relative(REPO, runDir)}`);
  if (record) {
    writeViewer(ctx);
    log(`viewer: ${path.relative(REPO, path.join(runDir, 'viewer.html'))}`);
  }
}

main().catch((e) => {
  console.error(`run: ${e.message}`);
  process.exit(1);
});
