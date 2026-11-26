/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Receive-payment and history scenarios. Payments are made outside the app, by the run's payer or
// with the app wallet's own seed, and what the app should show for them is worked out from the
// payments themselves and the fullnode's JSON (lib/book.js), never read from the app.

const fs = require('fs');
const path = require('path');
const { shown, units, lockedCount, shortId, feesOf, rowOf, NATIVE, } = require('./book');
const { buildImportFlow } = require('./walletStart');

const BANNER = /^We found tokens linked to your address/;
const UNAVAILABLE = 'Private transfers are not available for this wallet.';
const MODES = {
  'legacy-public': 'public', 'shown-public': 'public', public: 'public', 'hide-amount': 'amount', private: 'full',
};
const HTR = { name: 'Hathor', symbol: 'HTR', uid: NATIVE };
const isPrivate = (mode) => MODES[mode] !== 'public';

const total = (balance) => balance.private + balance.public;

/** Waits for a token's balance on Home, and opens the token. */
async function openAt(screen, uid, balance) {
  await screen.scrollTo({ id: `token-row-${uid}` });
  const nodes = await screen.shows({ [`token-balance-${uid}`]: shown(balance) }, { seconds: 60 });
  screen.tapIn(nodes, { id: `token-row-${uid}` });
}

/** What the token screen says of the private balance's state. */
const stateTexts = (ctx, state) => ({
  unlocked: [], locked: [lockedCount(ctx.locked)], 'broken-key': [UNAVAILABLE],
}[state]);

/** The balance's parts as the token screen shows them; a broken key shows none. */
const partsOf = (balance, state) => (state === 'broken-key' ? {} : {
  'balance-private': shown(balance.private), 'balance-public': shown(balance.public),
});

const rowTexts = (txId, description, amount) => ({
  [`tx-description-${txId}`]: description, [`tx-amount-${txId}`]: amount,
});

function addressFor(ctx, payment) {
  return payment === 'legacy-public' || payment === 'public'
    ? ctx.appAddress : ctx.walletTool('shielded-address', ctx.seedFile);
}

/** A token of the scenario's kind: the group's, or a new one the app never saw. */
function tokenOf(scenario, ctx, number) {
  const { token, known } = scenario.values;
  if (token === 'htr') return HTR;
  if (known !== 'unregistered') return ctx.tokens[token];
  return ctx.mintForPayer(token, `E2E New ${number}`, `EN${number}`);
}

async function runPayment(scenario, outcome, ctx, dir, api) {
  const { screen, step, flow } = api;
  const { values } = scenario;
  const state = values['private-balance'];
  const number = path.basename(dir);
  const amount = 100n + BigInt(number);
  const token = tokenOf(scenario, ctx, number);
  const address = addressFor(ctx, values.payment);
  const book = ctx.book[token.uid] || { private: 0n, public: 0n };
  ctx.book[token.uid] = book;

  let txId;
  await step(`1/3 pay: ${shown(amount)} ${token.symbol}, ${values.payment}, with the app ${values.app}`, async () => {
    if (values.app === 'closed') ctx.adbShell('am force-stop network.hathor.wallet');
    txId = ctx.walletTool('send', ctx.payerSeed, address, token.uid, String(amount), MODES[values.payment]);
    if (values.app === 'closed') {
      await ctx.unlock();
      await screen.wait({ text: 'Nano Contracts' }, 120);
    }
  });

  // What doesn't show can only be trusted once a later payment does.
  const laterPayment = () => step('runner: a public payment of 1.00 HTR, which must show', async () => {
    await ctx.fund(ctx.appAddress, '1');
    ctx.book[NATIVE].public += 100n;
    await screen.shows({ [`token-balance-${NATIVE}`]: shown(total(ctx.book[NATIVE])) }, { seconds: 60 });
  });

  if (outcome.id === 'edge-late-offer') {
    await laterPayment();
    await step('2/3 list: the token is not offered', () => screen.shows({}, { texts: ['Nano Contracts'], noTexts: [BANNER] }));
    await step('runner: start the app again', async () => {
      ctx.adbShell('am force-stop network.hathor.wallet');
      await ctx.unlock();
      await screen.wait({ text: 'Nano Contracts' }, 120);
    });
  }
  if (outcome.id === 'edge-not-shown' || outcome.id === 'edge-locked-count') {
    if (outcome.id === 'edge-locked-count') ctx.locked += 1;
    await laterPayment();
    const opened = values.known === 'unregistered' ? HTR : token;
    await step('2/3 list: the balance did not change, and no token is offered', async () => {
      await screen.shows({}, { texts: ['Nano Contracts'], noTexts: [BANNER] });
      await openAt(screen, opened.uid, total(ctx.book[opened.uid]));
    });
    await step(`3/3 token: ${opened.symbol} is as it was, without the payment`, async () => {
      await screen.shows({
        'token-available-balance': `${shown(total(ctx.book[opened.uid]))} ${opened.symbol}`,
        ...partsOf(ctx.book[opened.uid], state),
      }, { texts: stateTexts(ctx, state), noIds: [`tx-row-${txId}`] });
    });
    return `${txId} does not show, while a later public payment does${state === 'locked' ? `; ${lockedCount(ctx.locked)}` : ''}`;
  }

  book[isPrivate(values.payment) ? 'private' : 'public'] += amount;
  if (values.known === 'unregistered') {
    await step('2/3 list: the banner offers the token', () => screen.wait({ text: BANNER }, 60));
    const importDir = path.join(dir, 'import');
    fs.mkdirSync(importDir, { recursive: true });
    const file = path.join(importDir, 'flow.yaml');
    fs.writeFileSync(file, buildImportFlow([token.name]));
    const result = await flow(file, importDir, 'import the token from the banner');
    if (!result.ok) throw new Error(`importing ${token.symbol} failed: ${result.failed}`);
  }
  await step(`2/3 list: Home shows ${shown(total(book))} ${token.symbol}`, () => (
    openAt(screen, token.uid, total(book))));
  await step('3/3 token: the balance, its parts, and the payment on top of the history', async () => {
    const nodes = await screen.shows({
      'token-available-balance': `${shown(total(book))} ${token.symbol}`,
      ...partsOf(book, state),
      ...rowTexts(txId, `Received ${token.symbol}`, shown(amount)),
    }, { texts: stateTexts(ctx, state) });
    const first = nodes.find(({ id }) => id.startsWith('tx-row-'));
    if (first.id !== `tx-row-${txId}`) throw new Error('the payment is not the first of the history');
  });
  const late = outcome.id === 'edge-late-offer' ? ', offered only after a restart' : '';
  return `received ${shown(amount)} ${token.symbol} in ${txId}${late}`;
}

/** Makes the history's entry: who pays whom, by the scenario's values. */
function makeEntry(scenario, ctx, token, amount) {
  const { entry, privacy } = scenario.values;
  const toShielded = isPrivate(privacy);
  const to = {
    received: () => addressFor(ctx, toShielded ? privacy : 'legacy-public'),
    sent: () => ctx.walletTool(toShielded ? 'shielded-address' : 'address', ctx.peerSeed),
    self: () => addressFor(ctx, toShielded ? privacy : 'legacy-public'),
  }[entry]();
  const from = entry === 'received' ? ctx.payerSeed : ctx.seedFile;
  return ctx.walletTool('send', from, to, token.uid, String(amount), MODES[privacy]);
}

/** The fees the details should show; the rest of the checks of the details' bottom. */
function feeChecks(scenario, fees) {
  // On the wallet service wallet-lib reads the transaction without its fees (c-hist-fee-row).
  if (fees.total === 0n || scenario.values.facade === 'wallet-service') return null;
  const parts = ['network', 'privacy'];
  return {
    total: { 'fees-total': `${shown(fees.total)} HTR` },
    parts: Object.fromEntries(parts.filter((part) => fees[part] > 0n)
      .map((part) => [`fees-${part}`, `${shown(fees[part])} HTR`])),
    noParts: parts.filter((part) => fees[part] === 0n).map((part) => `fees-${part}`),
  };
}

async function runHistory(scenario, outcome, ctx, dir, { screen, step }) {
  const { values } = scenario;
  const state = values['private-balance'];
  const token = values.token === 'htr' ? HTR : ctx.tokens[values.token];
  const amount = 100n + BigInt(path.basename(dir));
  let txId;
  let fees;
  let row;
  await step(`runner: ${values.entry} ${shown(amount)} ${token.symbol}, ${values.privacy}, made outside the app`, async () => {
    txId = makeEntry(scenario, ctx, token, amount);
    fees = feesOf(await ctx.transaction(txId));
    row = rowOf({
      entry: values.entry, uid: token.uid, symbol: token.symbol, amount, fee: fees.total,
    });
  });
  // The totals are known; which outputs the wallet spent, private or public, is wallet-lib's
  // choice.
  const balance = ctx.totals[token.uid] + row.moved;
  ctx.totals[token.uid] = balance;
  if (token.uid !== NATIVE && values.entry !== 'received') ctx.totals[NATIVE] -= fees.total;
  await step(`1/3 list: Home shows ${shown(balance)} ${token.symbol}`, () => (
    openAt(screen, token.uid, balance)));
  let nodes;
  await step(`2/3 token: the same balance, and the row "${row.description}", ${row.amount}`, async () => {
    nodes = await screen.shows({
      'token-available-balance': `${shown(balance)} ${token.symbol}`,
      ...rowTexts(txId, row.description, row.amount),
    }, { texts: stateTexts(ctx, state) });
    if (state !== 'broken-key') {
      nodes = await screen.until('private and public parts that add up to the balance', (all) => {
        const parts = ['balance-private', 'balance-public'].map((id) => all.find((n) => n.id === id));
        if (!parts.every(Boolean)) return null;
        return units(parts[0].text) + units(parts[1].text) === balance ? all : null;
      });
    }
  });
  const fee = feeChecks(scenario, fees);
  const secret = isPrivate(values.privacy);
  await step(`3/3 tx: the details say the same${fee ? `, and Fees ${shown(fees.total)} HTR` : ', and no Fees'}`, async () => {
    screen.tapIn(nodes, { id: `tx-row-${txId}` });
    const unblind = values.entry === 'received' ? { [secret ? 'texts' : 'noTexts']: ['Copy unblinding values'] } : {};
    const { texts = [], noTexts = [] } = unblind;
    nodes = await screen.shows({
      'tx-details-amount': `${row.amount} ${token.symbol}`,
      'tx-details-description': row.description,
      'tx-details-id': shortId(txId),
      ...(fee ? fee.total : {}),
    }, {
      texts: [/^\d{2} \w{3} \d{4} • \d{2}:\d{2}$/, 'Public Explorer', ...texts],
      noTexts,
      noIds: fee ? [] : ['fees'],
      seconds: 60,
    });
  });
  if (fee) {
    await step(`3/3 tx: Fees opens into network ${shown(fees.network)} and privacy ${shown(fees.privacy)}`, async () => {
      screen.tapIn(nodes, { id: 'fees' });
      await screen.shows(fee.parts, { noIds: fee.noParts });
    });
  }
  return `${row.description} ${row.amount} in ${txId}; ${fee ? `fees ${shown(fees.total)} HTR` : 'no fees shown'}`;
}

module.exports = {
  runPayment, runHistory, openAt, HTR,
};
