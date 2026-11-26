/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The register-token scenarios: a token's details and fee model, its configuration string copied,
// the token unregistered and registered again from that string. What the details should say
// comes from the fullnode and wallet-lib, never from the app.

const { shown } = require('./book');
const { openAt } = require('./historyScenarios');

// TokenVersion of wallet-lib: the fee model each version shows (src/components/TokenDetails.js).
const FEE_MODELS = { 1: 'Fee Model: Deposit-Based', 2: 'Fee Model: Fee-Based' };
const BANNER = /^We found tokens linked to your address/;
const ALLOW_CAMERA = 'com.android.permissioncontroller:id/permission_allow_foreground_only_button';

/** The fee model a token's details show, from its version on the fullnode. */
function feeModelOf(version) {
  const model = FEE_MODELS[version];
  if (!model) throw new Error(`no fee model is known for token version ${version}`);
  return model;
}

const label = (token) => `${token.name} (${token.symbol})`;

/**
 * Taps a button at the bottom of a screen by its top edge: on this emulator Android's navigation
 * bar covers its centre, where a tap lands on Home and leaves the app (ROADMAP "Findings").
 */
async function press(screen, id) {
  const node = await screen.wait({ id });
  screen.input('tap', String(node.x), String(node.y - Math.floor(node.height / 2) + 8));
}

/** Opens the token from Home and its details, and checks them; gives the details' dump. */
async function openDetails(screen, token, balance, details) {
  await openAt(screen, token.uid, balance);
  await screen.shows({ 'token-available-balance': `${shown(balance)} ${token.symbol}` });
  await screen.tap({ id: 'token-info' });
  return screen.shows(details);
}

async function runRegister(scenario, outcome, ctx, dir, { screen, step }) {
  const token = ctx.tokens[scenario.values.token];
  const balance = ctx.totals[token.uid];
  const { version } = await ctx.tokenOnChain(token.uid);
  const config = ctx.walletTool('config-string', token.uid, token.name, token.symbol);
  const details = { 'token-details-fee-model': feeModelOf(version), 'token-details-config': config };

  let dump;
  // So that the paste in 4/5 can only show the string if the tap in 2/5 copied it.
  await step('runner: copy something else first, the Receive address (a tap copies it)', async () => {
    await screen.tap({ id: 'tab-receive' });
    await screen.tap({ id: 'receive-address' }, 60);
    // Android's preview of what was copied covers the Home tab until a touch elsewhere: the
    // QR code, which does nothing.
    await screen.until('the dashboard, past the clipboard preview', (nodes) => {
      if (nodes.some(({ text }) => text === 'Nano Contracts')) return true;
      if (nodes.some(({ id }) => id === 'receive-qr-code')) screen.tapIn(nodes, { id: 'receive-qr-code' });
      if (nodes.some(({ id }) => id === 'tab-home')) screen.tapIn(nodes, { id: 'tab-home' });
      return false;
    }, 30);
  });
  await step(`1/5 info: ${token.symbol}'s details say "${details['token-details-fee-model']}" and its configuration string`, async () => {
    dump = await openDetails(screen, token, balance, details);
  });
  // "Copied to clipboard!" shows for 1.5 s, less than a dump takes: the paste in 4/5 checks it.
  await step('2/5 copy: tap the configuration string', async () => {
    screen.tapIn(dump, { id: 'token-details-config' });
  });
  await step('3/5 unregister: nothing happens until the switch is on; then the token leaves Home, and the banner offers it', async () => {
    await screen.tap({ id: 'token-details-unregister' });
    await screen.wait({ text: `I want to unregister the token ${label(token)}` });
    await press(screen, 'unregister-token-confirm');
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    await screen.shows({}, { texts: [`I want to unregister the token ${label(token)}`], seconds: 5 });
    await screen.tap({ id: 'unregister-token-switch' });
    await press(screen, 'unregister-token-confirm');
    // The wallet still holds it, so the banner offers it for import again.
    await screen.shows({}, { texts: ['Nano Contracts', BANNER], noIds: [`token-row-${token.uid}`], seconds: 60 });
  });
  await step('4/5 register: Settings > Register a token > Manual info, the string pasted', async () => {
    await screen.tap({ id: 'tab-settings' });
    await screen.tap({ text: 'Register a token' });
    // The camera is asked for once per install, before the scanner shows.
    const where = await screen.until('the scanner, or the camera permission', (nodes) => (
      nodes.find(({ id }) => id === 'register-token-manual' || id === ALLOW_CAMERA)), 30);
    if (where.id === ALLOW_CAMERA) screen.input('tap', String(where.x), String(where.y));
    await screen.tap({ id: 'register-token-manual' });
    await screen.tap({ id: 'register-token-config' });
    screen.input('keyevent', '279'); // paste
    await screen.shows({ 'register-token-config': config }, {
      texts: [outcome.message, `Name: ${token.name}`, `Symbol: ${token.symbol}`],
    });
    await press(screen, 'register-token-submit');
  });
  await step(`5/5 check: Home has ${shown(balance)} ${token.symbol} again, and the details the same fee model`, async () => {
    await screen.wait({ text: 'Nano Contracts' }, 30);
    await openDetails(screen, token, balance, details);
  });
  return `${token.symbol} unregistered and registered again by its configuration string: ${shown(balance)}, ${details['token-details-fee-model']}; once unregistered, it left Home and the banner offered it`;
}

module.exports = { runRegister, feeModelOf };
