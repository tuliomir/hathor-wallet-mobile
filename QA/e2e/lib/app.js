/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The app the emulator runs, and what it runs on. A run on an app older than its sources would
// pass or fail for code that isn't there, so the app's build and install both carry the id of the
// sources they came from (lib/fingerprint.js appId).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const E2E = path.join(__dirname, '..');
const REPO = path.resolve(E2E, '..', '..');
const ADB = process.env.ADB || path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const EMULATOR = process.env.EMULATOR || path.join(os.homedir(), 'Android/Sdk/emulator/emulator');
const AVD = process.env.AVD || 'hnni';
const APK = path.join(REPO, 'android/app/build/outputs/apk/e2e/app-e2e.apk');
const BUILT = `${APK}.sources`;
const APP = 'network.hathor.wallet';
const INSTALLED = '/data/local/tmp/e2e-app.sources';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tried = (fn) => {
  try {
    return fn();
  } catch (e) {
    return '';
  }
};

/** When the app was last installed, which tells a stamp of another install apart. */
const installTime = () => (/lastUpdateTime=(.+)/.exec(tried(() => adb('shell', 'dumpsys', 'package', APP))) || [])[1] || '';

/** The id of the sources the installed app was built from, or null when nothing says. */
function installedId() {
  const [id, ...time] = tried(() => adb('shell', 'cat', INSTALLED)).split(' ');
  return id && time.join(' ') === installTime() ? id : null;
}

const builtId = () => (fs.existsSync(APK) && fs.existsSync(BUILT) ? fs.readFileSync(BUILT, 'utf8').trim() : null);

function build(id, log) {
  log('building the app: its sources changed since the last build (1.5 to 5 min)');
  fs.rmSync(BUILT, { force: true });
  const out = path.join(E2E, 'evidence', 'build.log');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fd = fs.openSync(out, 'w');
  try {
    execFileSync('./gradlew', ['assembleE2e', '-PreactNativeArchitectures=x86_64'], {
      cwd: path.join(REPO, 'android'),
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        ANDROID_HOME: process.env.ANDROID_HOME || path.join(os.homedir(), 'Android/Sdk'),
        JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64',
      },
    });
  } catch (e) {
    throw new Error(`the app did not build; see ${out}`);
  } finally {
    fs.closeSync(fd);
  }
  fs.writeFileSync(BUILT, `${id}\n`);
}

/** Puts the app of these sources on the emulator, building it when it has to. */
function ensureApp(id, log) {
  if (installedId() === id) return;
  if (builtId() !== id) build(id, log);
  log('installing the app');
  adb('install', '-r', APK);
  adb('shell', `echo '${id} ${installTime()}' > ${INSTALLED}`);
}

/** Why the installed app isn't the one of these sources, or null when it is. */
const staleApp = (id) => (installedId() === id ? null
  : 'the app on the emulator was not built from this checkout\'s sources (or not installed by suite.js)');

async function until(what, seconds, check) {
  for (let i = 0; i < seconds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await check()) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
  }
  throw new Error(`${what} did not come up in ${seconds} s`);
}

const answers = (url) => fetch(url).then((r) => r.ok, () => false);

async function ensurePrivnet(walletService, log) {
  const up = async () => (await Promise.all([
    answers('http://localhost:18083/v1a/status'),
    answers('http://localhost:18042/flags'),
    answers('http://localhost:13020/ready'),
    ...(walletService ? [answers('http://localhost:18300/dev/version')] : []),
  ])).every(Boolean);
  if (await up()) return;
  log(`starting the privnet${walletService ? ', with the wallet service' : ''}`);
  execFileSync('docker', ['compose', ...(walletService ? ['--profile', 'ws'] : []), 'up', '-d'], {
    cwd: path.join(E2E, 'privnet'), stdio: 'ignore',
  });
  await until('the privnet', 180, up);
}

/** Answers the "System UI isn't responding" dialog of a freshly booted emulator with Wait. */
function answerDialog() {
  const xml = tried(() => adb('exec-out', 'uiautomator', 'dump', '/dev/tty'));
  if (!/isn(&apos;|'|’)t responding/.test(xml)) return;
  const at = /text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  if (!at) return;
  const [x1, y1, x2, y2] = at.slice(1).map(Number);
  adb('shell', 'input', 'tap', String((x1 + x2) / 2), String((y1 + y2) / 2));
}

async function ensureEmulator(log) {
  if (tried(() => adb('shell', 'getprop', 'sys.boot_completed')) === '1') {
    answerDialog();
    return;
  }
  log(`booting the emulator ${AVD}`);
  spawn(EMULATOR, ['-avd', AVD, '-no-window', '-no-audio', '-no-snapshot', '-gpu', 'swiftshader_indirect'], {
    detached: true, stdio: 'ignore',
  }).unref();
  await until('the emulator', 240, () => tried(() => adb('shell', 'getprop', 'sys.boot_completed')) === '1');
  // A fresh emulator is busy for about 2 min, and may say that System UI isn't responding.
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(15000);
    answerDialog();
  }
}

/** Takes the privnet and the emulator down: idle, they keep the CPU busy. */
function down(log) {
  log('taking down the emulator and the privnet');
  tried(() => adb('emu', 'kill'));
  execFileSync('docker', ['compose', '--profile', 'ws', 'down'], { cwd: path.join(E2E, 'privnet'), stdio: 'ignore' });
}

module.exports = {
  ensureApp, staleApp, ensurePrivnet, ensureEmulator, down, builtId, installedId,
};
