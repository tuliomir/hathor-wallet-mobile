/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The address-mode scenarios, on the plain privnet (lib/app.js PRIVNETS), where a new wallet
// starts in single-address mode: to multi and back while no address past the first has
// transactions, then a payment to the second address, after which the wallet stays multi. The
// addresses Receive should show are derived from the seed, outside the app.

const { openSetting } = require('./resetScenarios');

const SINGLE = 'address-mode-single';
const MULTI = 'address-mode-multi';
const NEW_ADDRESS = 'receive-new-address';

/** Settings > Address Mode, once it has checked the wallet: the two options' nodes. */
async function openAddressMode(screen) {
  await openSetting(screen, 'Address Mode');
  return screen.until('the address modes', (nodes) => (
    nodes.some(({ id }) => id === SINGLE) && nodes.some(({ id }) => id === MULTI) && nodes), 60);
}

/** Fails unless Address Mode shows `selected`, with Single offered or not. */
function modesAre(nodes, selected, singleOffered) {
  const single = nodes.find(({ id }) => id === SINGLE);
  const multi = nodes.find(({ id }) => id === MULTI);
  const wrong = [
    single.checked !== (selected === 'single') && `Single is ${single.checked ? '' : 'not '}selected`,
    multi.checked !== (selected === 'multi') && `Multi is ${multi.checked ? '' : 'not '}selected`,
    single.enabled !== singleOffered && `Single is ${single.enabled ? 'offered' : 'disabled'}`,
  ].filter(Boolean);
  if (wrong.length) throw new Error(`Address Mode: ${wrong.join('; ')}`);
}

/** Picks a mode and saves it; the wallet starts again. */
async function saveMode(screen, nodes, mode) {
  screen.tapIn(nodes, { id: mode === 'single' ? SINGLE : MULTI });
  await screen.until(`${mode} selected`, (all) => all.find(({ id, checked }) => id === `address-mode-${mode}` && checked), 10);
  await screen.tap({ id: 'address-mode-save' });
  // The wallet reloads under the screen, which stays: saved, the mode is selected and Save is off.
  await screen.until('the mode saved', (all) => (
    !all.some(({ text }) => /^Changing/.test(text))
    && all.some(({ id, enabled }) => id === 'address-mode-save' && !enabled)
    && all.some(({ id, checked }) => id === `address-mode-${mode}` && checked)), 120);
  await screen.home();
  await screen.wait({ text: 'Nano Contracts' }, 120);
}

/** Receive shows this address, with or without New address. */
async function receiveShows(screen, address, newAddress) {
  await screen.tap({ id: 'tab-receive' });
  await screen.shows({ 'receive-address': address }, {
    texts: [], noIds: newAddress ? [] : [NEW_ADDRESS], seconds: 60,
  });
  if (newAddress) await screen.wait({ id: NEW_ADDRESS });
}

async function runAddressMode(scenario, outcome, ctx, dir, { screen, step }) {
  const [first, second] = [0, 1].map((index) => ctx.walletTool('address', ctx.seedFile, String(index)));
  const home = async () => {
    await screen.tap({ id: 'tab-home' });
    await screen.wait({ text: 'Nano Contracts' });
  };

  await step('1/5 single: a new wallet is in single-address mode; Receive shows the first address, no New address', async () => {
    modesAre(await openAddressMode(screen), 'single', true);
    await screen.home();
    await receiveShows(screen, first, false);
    await home();
  });

  await step('2/5 multi: saved, the wallet starts again; New address gives the second address', async () => {
    await saveMode(screen, await openAddressMode(screen), 'multi');
    modesAre(await openAddressMode(screen), 'multi', true);
    await screen.home();
    await receiveShows(screen, first, true);
    await screen.tap({ id: NEW_ADDRESS });
    await screen.shows({ 'receive-address': second }, { seconds: 30 });
    await home();
  });

  await step('3/5 back: Single saved again; Receive is back on the first address, with no New address', async () => {
    await saveMode(screen, await openAddressMode(screen), 'single');
    modesAre(await openAddressMode(screen), 'single', true);
    await screen.home();
    await receiveShows(screen, first, false);
    await home();
  });

  // On the fullnode a single-address wallet watches the first address only: the payment to the
  // second doesn't show until the wallet starts again, which is trusted once a later payment, to
  // the first address, does. The wallet service shows both at once (ROADMAP "Findings").
  const seenWhileSingle = scenario.values.facade === 'wallet-service' ? '2.00' : '1.00';
  await step(`4/5 pay: 1.00 HTR to the second address, then 1.00 to the first; Home shows ${seenWhileSingle}`, async () => {
    await ctx.fund(second, '1');
    await ctx.fund(first, '1');
    await screen.shows({ 'token-balance-00': seenWhileSingle }, { seconds: 60 });
  });

  await step(`5/5 restart: started again, the wallet counts both payments (2.00 HTR) and is multi; Single is disabled: "${outcome.message}"`, async () => {
    ctx.adbShell('am force-stop network.hathor.wallet');
    await ctx.unlock();
    await screen.shows({ 'token-balance-00': '2.00' }, { texts: ['Nano Contracts'], seconds: 120 });
    const nodes = await openAddressMode(screen);
    modesAre(nodes, 'multi', false);
    await screen.shows({}, { texts: [outcome.message] });
    await screen.home();
    await screen.tap({ id: 'tab-receive' });
    await screen.wait({ id: NEW_ADDRESS }, 60);
    await home();
  });
  return `single, then multi (New address gave ${second.slice(0, 6)}…), single again; 1.00 HTR to it and 1.00 to the first: ${seenWhileSingle} while single; `
    + 'after a restart 2.00 HTR, multi, Single disabled with the warning';
}

module.exports = { runAddressMode, modesAre };
