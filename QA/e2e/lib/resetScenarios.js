/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The reset-import scenarios: the wallet reset from Settings, the app closed and opened on its
// welcome screen, and the same wallet imported from its words, with its history, balances and
// tokens back. It ends as it started, every token registered again, so a later job can go on with
// it (README "Resetting and importing the wallet").

const fs = require('fs');
const path = require('path');
const { shown, NATIVE } = require('./book');
const { openAt } = require('./historyScenarios');
const { press } = require('./registerScenarios');

const WELCOME = 'Welcome to Hathor Wallet!';
const BANNER = /^We found tokens linked to your address/;
const SERVERS = { fullnode: /localhost:18083/, 'wallet-service': /localhost:18300/ };
// 24 words of no wordlist.
const RANDOM_WORDS = Array.from({ length: 24 }, (_, i) => `zq${String.fromCharCode(97 + i)}x`);
// What reset must have wiped: the wallet's record and the custom network.
const WIPED = ['asyncstorage:access', 'networkSettings:networkSettings'];

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Types into the focused field: adb's input text takes %s for a space. */
const typeWords = (screen, words) => screen.input('text', words.join('%s'));

/** The history rows on screen, by transaction. */
const rowsOf = (nodes) => nodes.filter(({ id }) => id.startsWith('tx-row-')).map(({ id }) => id).sort();

/** Opens a token from Home at its balance, and gives its history's rows; back on Home after. */
async function historyOf(screen, { uid, symbol }, balance) {
  await openAt(screen, uid, balance);
  await screen.shows({ 'token-available-balance': `${shown(balance)} ${symbol}` }, { seconds: 60 });
  const rows = rowsOf(await screen.until('the history', (nodes) => rowsOf(nodes).length && nodes, 60));
  await screen.home();
  return rows;
}

/** Fails unless the token's history shows what it did before the reset. */
async function sameHistory(screen, token, balance, before) {
  const after = await historyOf(screen, token, balance);
  if (after.join() !== before.join()) {
    throw new Error(`${token.symbol}'s history shows ${after.length} rows, not the ${before.length} it had (${before.join(', ')})`);
  }
}

// The banner's link is a Text inside its paragraph's, with no node of its own for adb: Maestro
// finds it (README "Selectors").
const BANNER_LINK = `appId: network.hathor.wallet
name: the banner's Import tokens link
---
- extendedWaitUntil: { visible: 'Import tokens', timeout: 60000 }
- tapOn: 'Import tokens'
`;

/** Imports these tokens from the dashboard's banner, of `found` offered. */
async function importFromBanner({ screen, flow }, dir, tokens, found) {
  const linkDir = path.join(dir, `banner-${found}`);
  fs.mkdirSync(linkDir, { recursive: true });
  fs.writeFileSync(path.join(linkDir, 'flow.yaml'), BANNER_LINK);
  const tapped = await flow(path.join(linkDir, 'flow.yaml'), linkDir, 'tap the banner\'s Import tokens');
  if (!tapped.ok) throw new Error(`the banner's link: ${tapped.failed}`);
  await screen.wait({ text: `Tokens found (${found})` }, 30);
  for (const { name } of tokens) {
    // eslint-disable-next-line no-await-in-loop
    const node = await screen.scrollTo({ text: name });
    screen.input('tap', String(node.x), String(node.y));
  }
  await press(screen, 'import-tokens-continue');
  await screen.wait({ text: 'Confirm Import' });
  await press(screen, 'confirm-import-tokens');
  await screen.wait({ text: 'New tokens added!' }, 30);
  await screen.tap({ id: 'import-tokens-see-all' });
  await screen.wait({ text: 'Nano Contracts' });
}

/** Opens a Settings item: Settings keeps its scroll, so from its top. */
async function openSetting(screen, text) {
  await screen.tap({ id: 'tab-settings' });
  for (let i = 0; i < 4; i += 1) {
    screen.input('swipe', '540', '900', '540', '1700', '300');
    // eslint-disable-next-line no-await-in-loop
    await sleep(300);
  }
  const item = await screen.scrollTo({ text });
  screen.input('tap', String(item.x), String(item.y));
}

const rowsShown = (tokens, ctx) => Object.fromEntries(tokens.map(({ uid }) => (
  [`token-balance-${uid}`, shown(ctx.totals[uid])])));

async function runResetImport(scenario, outcome, ctx, dir, api) {
  const { screen, step } = api;
  const { facade } = scenario.values;
  const [first, rest] = [ctx.tokens.deposit, ctx.tokens.fee];
  const htr = ctx.totals[NATIVE];
  const HTR = { uid: NATIVE, symbol: 'HTR' };
  const history = {};
  await step('runner: the histories of HTR and of the tokens before the reset', async () => {
    for (const token of [HTR, first, rest]) {
      // eslint-disable-next-line no-await-in-loop
      history[token.uid] = await historyOf(screen, token, ctx.totals[token.uid]);
    }
  });

  await step('1/7 reset: Reset Wallet does nothing until the switch is on; then the welcome screen', async () => {
    await openSetting(screen, 'Reset wallet');
    await screen.wait({ text: 'Are you sure?' });
    // Until it is back, the app holds no wallet a later job could go on with.
    ctx.forgetWallet();
    await press(screen, 'reset-wallet-confirm');
    await sleep(1500);
    await screen.shows({}, { texts: ['Are you sure?'], seconds: 5 });
    await screen.tap({ id: 'reset-wallet-switch' });
    await press(screen, 'reset-wallet-confirm');
    await screen.wait({ text: WELCOME }, 60);
  });

  await step('2/7 reopen: closed and opened, the app is on its welcome screen, its wallet and network gone', async () => {
    ctx.adbShell('am force-stop network.hathor.wallet');
    ctx.launchApp();
    await screen.wait({ text: WELCOME }, 120);
    const kept = WIPED.filter((key) => ctx.storageKeys().includes(key));
    if (kept.length) throw new Error(`the app's storage still has ${kept.join(', ')}`);
  });
  await step('runner: point the app at the privnet again, as before onboarding (a reset forgets it)', async () => {
    ctx.pointAtPrivnet(facade);
    ctx.launchApp();
    await screen.wait({ text: WELCOME }, 120);
  });

  await step('3/7 words: 24 random words give "Invalid words." and Next does nothing', async () => {
    await screen.tap({ id: 'welcome-terms-switch' });
    // Right after a launch the first tap may be lost, as in flows/onboard.yaml.
    await screen.until('Import Wallet', (nodes) => {
      const target = nodes.find(({ id }) => id === 'onboarding-import-wallet');
      if (!target && nodes.some(({ id }) => id === 'welcome-start')) screen.tapIn(nodes, { id: 'welcome-start' });
      return target;
    }, 60);
    await screen.tap({ id: 'onboarding-import-wallet' });
    await screen.tap({ id: 'load-words-input' });
    typeWords(screen, RANDOM_WORDS);
    await screen.shows({}, { texts: [/^Invalid words\. List of invalid words: zqax/, '24/24'] });
    await press(screen, 'load-words-next');
    await sleep(1500);
    await screen.shows({}, { texts: ['To import a wallet,'], noTexts: ['Create a new PIN code,'], seconds: 5 });
  });

  // The words field shows what is typed in clear (ROADMAP "Findings"): from the moment the seed is
  // typed until the screen is left, the recording is blacked out, and on a failure the field is
  // emptied before the runner takes its screenshot and dump.
  await step('4/7 import: the wallet\'s own words, the PIN twice, Start the wallet', async () => {
    await screen.tap({ id: 'load-words-input' });
    await sleep(1000); // Ctrl+A goes nowhere until the field has focus
    screen.input('keycombination', '113', '29'); // Ctrl+A
    screen.input('keyevent', '67'); // Delete
    await screen.shows({}, { texts: ['0/24'] });
    await api.hidden('runner: type the wallet\'s 24 words (adb), and Next', async () => {
      try {
        typeWords(screen, fs.readFileSync(ctx.seedFile, 'utf8').trim().split(/\s+/));
        await screen.shows({}, { texts: ['24/24'], noTexts: [/^Invalid/, /^Must have/] });
        await press(screen, 'load-words-next');
        await screen.until('the words screen to go', (nodes) => !nodes.some(({ id }) => id === 'load-words-input'), 30);
      } catch (e) {
        screen.input('keycombination', '113', '29');
        screen.input('keyevent', '67');
        throw e;
      }
    });
    await ctx.typePin('Create a new PIN code');
    await sleep(1500); // the confirmation has its keypad where the first one was
    await ctx.typePin('To confirm the PIN');
    await screen.tap({ id: 'choose-pin-start-wallet' }, 30);
    await screen.wait({ text: 'Nano Contracts' }, 180);
  });

  await step(`5/7 load: HTR is ${shown(htr)} with the same history, on the ${facade}`, async () => {
    await screen.tap({ id: 'tab-settings' });
    await screen.scrollTo({ text: SERVERS[facade] });
    await screen.tap({ id: 'tab-home' });
    await screen.wait({ text: 'Nano Contracts' });
    await sameHistory(screen, HTR, htr, history[NATIVE]);
  });

  await step(`6/7 tokens: the banner offers 2 tokens; ${first.symbol} imported with its history, ${rest.symbol} left, and still offered`, async () => {
    await screen.shows({}, { texts: [BANNER], seconds: 60 });
    await importFromBanner(api, dir, [first], 2);
    await screen.scrollTo({ id: `token-row-${first.uid}` });
    await screen.shows(rowsShown([first], ctx), {
      texts: [BANNER], noIds: [`token-row-${rest.uid}`], seconds: 60,
    });
    await sameHistory(screen, first, ctx.totals[first.uid], history[first.uid]);
  });

  await step(`7/7 rest: ${rest.symbol} imported too, with its history; no banner, and Settings > Import tokens has none left`, async () => {
    await importFromBanner(api, dir, [rest], 1);
    await screen.scrollTo({ id: `token-row-${rest.uid}` });
    await screen.shows(rowsShown([first, rest], ctx), { noTexts: [BANNER], seconds: 60 });
    await sameHistory(screen, rest, ctx.totals[rest.uid], history[rest.uid]);
    await openSetting(screen, 'Import tokens');
    await screen.wait({ text: outcome.message }, 30);
    ctx.markWallet();
  });
  return `reset, reopened on the welcome screen, imported again: HTR ${shown(htr)}, `
    + `${first.symbol} then ${rest.symbol} from the banner, each with its history as before (`
    + `${[HTR, first, rest].map(({ uid, symbol }) => `${symbol} ${history[uid].length}`).join(', ')} rows), nothing left to import`;
}

module.exports = { runResetImport, openSetting, RANDOM_WORDS };
