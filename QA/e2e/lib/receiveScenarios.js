/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The receive scenarios: the address Receive shows, as text, QR code, clipboard and share sheet,
// against the addresses derived from the seed outside the app.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { RECEIVE_SAYS } = require('./walletStart');

const ADDRESS = { id: 'receive-address' };
// More than the New address of a wallet's earlier runs moved past.
const DERIVED = 30;
const REASON = 'Private transfers are not available for this wallet.';

function qrCode(screen, dir) {
  const png = path.join(dir, 'receive.png');
  fs.writeFileSync(png, screen.screenshot());
  return execFileSync('node', [path.join(__dirname, '..', 'tools', 'qr.js'), png], { encoding: 'utf8' }).trim();
}

function same(what, got, wanted) {
  if (got !== wanted) throw new Error(`${what} is "${got}", not "${wanted}"`);
}

async function notice(scenario, { screen, step }) {
  const state = scenario.values['private-balance'];
  await step(`1/1 open: Receive says ${RECEIVE_SAYS[state]}, and shows no address`, async () => {
    await screen.tap({ id: 'tab-receive' });
    await screen.wait({ text: RECEIVE_SAYS[state] }, 60);
    if (state === 'locked') await screen.wait({ text: 'Unlock private balance' });
    else await screen.wait({ text: REASON });
    const nodes = screen.nodes();
    if (nodes.some(({ id, text }) => id === ADDRESS.id || /^[WK][1-9A-HJ-NP-Za-km-z]{33,}$/.test(text))) {
      throw new Error('Receive shows an address');
    }
    if (state === 'broken-key' && nodes.some(({ text }) => text === 'Unlock private balance')) {
      throw new Error('Receive offers an unlock');
    }
  });
  return `Receive says "${RECEIVE_SAYS[state]}" and shows no address`;
}

async function runReceive(scenario, ctx, dir, { screen, step }) {
  if (scenario.values['private-balance'] !== 'unlocked') return notice(scenario, { screen, step });
  const derived = ctx.walletTool('shielded-addresses', ctx.seedFile, String(DERIVED)).split(',');
  let address;
  await step('1/3 open: the address is one of the wallet\'s, and the QR code says it', async () => {
    await screen.tap({ id: 'tab-receive' });
    address = (await screen.until('an address', (nodes) => (
      nodes.find(({ id, text }) => id === ADDRESS.id && text.startsWith('K'))), 60)).text;
    if (!derived.includes(address)) throw new Error(`${address} is not one of the wallet's`);
    same('the QR code', qrCode(screen, dir), `hathor:${address}`);
  });
  await step('3/3 share: the share sheet has the address', async () => {
    await screen.tap({ id: 'receive-share' });
    const preview = await screen.wait({ id: 'android:id/content_preview_text' });
    same('the shared text', preview.text, `Here is my address: ${address}`);
    screen.back();
  });
  const next = derived[derived.indexOf(address) + 1];
  await step('2/3 new-address: the next address and its QR code show', async () => {
    await screen.tap({ id: 'receive-new-address' });
    await screen.shows({ [ADDRESS.id]: next }, { seconds: 60 });
    same('the QR code', qrCode(screen, dir), `hathor:${next}`);
  });
  await step('a tap on the address copies it: pasted in Send', async () => {
    await screen.tap(ADDRESS);
    await ctx.clearSendAddress();
    screen.input('keyevent', '279'); // paste
    await screen.shows({ 'send-address-input': next });
    await ctx.clearSendAddress();
  });
  return 'the text, QR code, share sheet and clipboard agree with the derived addresses, before and after New address';
}

module.exports = { runReceive };
