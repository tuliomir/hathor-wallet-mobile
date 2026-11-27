/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The settings scenarios: About's version, the app's unique identifier, and Security: a PIN
// confirmation that differs, the PIN changed, the wallet locked, and the app started again, each
// opened with the new PIN. The PIN goes back to the kit's at the end, so the wallet ends as it
// started (README "Settings and the PIN").

const { openSetting } = require('./resetScenarios');
const { RECEIVE_SAYS } = require('./walletStart');

const PIN = '123456';
const NEW_PIN = '246802';
const OTHER_PIN = '246801';
const DIFFER = "PIN codes don't match.";

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Changes the PIN from `from` to `to` on Security > Change PIN, which never goes idle: its prompts
 * are read from Maestro's hierarchy. With `confirmFirst`, the first confirmation typed is that
 * PIN, which must be refused.
 */
async function changePin(screen, ctx, from, to, confirmFirst, refused) {
  await openSetting(screen, 'Security');
  await screen.tap({ text: 'Change PIN' });
  await ctx.hierarchyShows(/current PIN/);
  await ctx.typePin('Change PIN', from);
  await ctx.hierarchyShows(/^Please enter your new PIN$/);
  await ctx.typePin('the new PIN', to);
  await ctx.hierarchyShows(/new PIN again/);
  if (confirmFirst) {
    await ctx.typePin('the confirmation', confirmFirst);
    await ctx.hierarchyShows(new RegExp(DIFFER.replace('.', '\\.')));
    await sleep(500);
  }
  await ctx.typePin('the confirmation', to);
  if (refused) {
    await ctx.hierarchyShows(/^Error while changing PIN$/);
    screen.back(); // out of Change PIN
  } else {
    await ctx.hierarchyShows(/^New PIN recorded$/);
    screen.back(); // the success modal
  }
  await sleep(1000);
}

/** What Receive says of the private balance in each state. */
async function receiveSays(screen, state) {
  await screen.tap({ id: 'tab-receive' });
  if (state === 'unlocked') {
    await screen.until('a private address', (nodes) => (
      nodes.find(({ id, text }) => id === 'receive-address' && text.startsWith('K'))), 60);
  } else {
    await screen.wait({ text: RECEIVE_SAYS[state] }, 60);
  }
  await screen.tap({ id: 'tab-home' });
  await screen.wait({ text: 'Nano Contracts' });
}

async function runSettings(scenario, outcome, ctx, dir, { screen, step }) {
  const state = scenario.values['private-balance'];
  const version = ctx.versionOfApp();
  const about = `v${version.name} (build ${version.code})`;

  await step(`1/6 about: Settings > About says ${about}`, async () => {
    await openSetting(screen, 'About');
    await screen.wait({ text: about }, 30);
    screen.back();
    await screen.tap({ id: 'tab-home' });
    await screen.wait({ text: 'Nano Contracts' });
  });

  const id = await ctx.unleashUserId();
  if (!id) throw new Error('the fake Unleash has seen no user id');
  await step('runner: copy something else first, a token\'s configuration string', async () => {
    const token = ctx.tokens.deposit;
    await screen.scrollTo({ id: `token-row-${token.uid}` });
    await screen.tap({ id: `token-row-${token.uid}` });
    await screen.tap({ id: 'token-info' });
    await screen.tap({ id: 'token-details-config' });
    await screen.home();
  });
  await step(`2/6 identifier: Settings shows ${id}, the user id the app gives Unleash; pasted, it is the same`, async () => {
    await screen.tap({ id: 'tab-settings' });
    // Near the bottom of Settings: swipe down until it shows.
    const nodes = await screen.until('the unique app identifier', (all) => {
      if (all.some((n) => n.id === 'settings-unique-id')) return all;
      screen.input('swipe', '540', '1700', '540', '1100', '400');
      return null;
    }, 30);
    await screen.shows({ 'settings-unique-id': id });
    screen.tapIn(nodes, { id: 'settings-unique-id' });
    await ctx.clearSendAddress();
    screen.input('keyevent', '279'); // paste
    await screen.shows({ 'send-address-input': id });
    await ctx.clearSendAddress();
    await screen.tap({ id: 'tab-home' });
  });

  // A refused change saves nothing: the PIN that opens the wallet afterwards is the old one.
  const refused = outcome.id === 'err-change-failed';
  const [good, bad] = refused ? [PIN, NEW_PIN] : [NEW_PIN, PIN];
  const change = refused ? `then "${outcome.message}"` : 'then takes the new PIN';
  await step(`3/6 mismatch, 4/6 change: Change PIN refuses a confirmation that differs ("${DIFFER}"), ${change}`, async () => {
    await changePin(screen, ctx, PIN, NEW_PIN, OTHER_PIN, refused);
  });

  await step(`5/6 lock: Lock wallet; the ${refused ? 'new' : 'old'} PIN is refused, the ${refused ? 'old' : 'new'} one opens the wallet`, async () => {
    await screen.tap({ text: 'Lock wallet' });
    await ctx.hierarchyShows(/^Enter your PIN Code/);
    await ctx.typePin('the lock screen', bad);
    await ctx.hierarchyShows(/^Incorrect PIN Code\. Try again\.$/);
    await ctx.typePin('the lock screen', good);
    await screen.wait({ text: 'Nano Contracts' }, 60);
  });

  await step(`6/6 restart: closed and opened, the ${refused ? 'old' : 'new'} PIN opens it; Receive says the private balance is ${state}`, async () => {
    ctx.adbShell('am force-stop network.hathor.wallet');
    ctx.launchApp();
    await ctx.typePin('the lock screen', good);
    await screen.wait({ text: 'Nano Contracts' }, 120);
    await receiveSays(screen, state);
  });

  if (!refused) {
    await step('runner: Change PIN again, back to the kit\'s PIN', async () => {
      await changePin(screen, ctx, NEW_PIN, PIN);
      await screen.home();
    });
  }
  const pins = refused
    ? `the change refused ("${outcome.message}"), and the old PIN still the one that opens it`
    : 'the PIN changed, the old one refused on the lock screen, the new one opened it there and after a restart';
  return `${about}; identifier ${id}; a differing confirmation refused; ${pins}; the private balance ${state}`
    + `${refused ? '' : '; back to the kit\'s PIN'}`;
}

module.exports = { runSettings, NEW_PIN };
