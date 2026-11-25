/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Turns one create-token scenario of the QA graph into a Maestro flow: the creation path (type,
// name, symbol, amount, confirm, PIN, details) up to the step where the expected outcome shows,
// then a check for it. Like sendFlow.js, it finds elements by testID and checks messages by text.

// eslint-disable-next-line import/no-extraneous-dependencies
const YAML = require('yaml');
const { messagePattern } = require('./sendFlow');
const { pinSteps, reachedStep, backGroup } = require('./flowSteps');

const STEP_ORDER = ['type', 'name', 'symbol', 'amount', 'confirm', 'authorize', 'detail'];
const tap = (id) => ({ tapOn: { id } });
const waitFor = (visible, timeout = 15000) => ({ extendedWaitUntil: { visible, timeout } });

// "You have <amount> HTR available", under the amount.
const AVAILABLE = 'create-token-available';
const AMOUNTS = { normal: '100.00', cents: '0.50', thousand: '1000.00' };
// What the typed amount adds to 100 times the available HTR (the deposit is 1%).
const ABOVE_EXACT = { exact: '0', 'over-balance': '1', 'over-by-rounding': '0.01' };

// The HTR the app itself knows of: a payment it missed would pass every "not enough HTR" scenario.
function fundingCheck(funding) {
  if (!funding) return [];
  const htr = funding === 'zero-htr' ? '0\\.00' : '[0-9,.]*[1-9][0-9,.]*';
  return [waitFor(`You have ${htr} HTR available`)];
}

function amountSteps(amount) {
  if (amount === 'empty') return [];
  if (AMOUNTS[amount]) return [{ inputText: AMOUNTS[amount] }];
  return [
    { copyTextFrom: { id: AVAILABLE } },
    { evalScript: `\${output.amount = (parseFloat(maestro.copiedText.replace(/,/g, '').match(/[0-9.]+/)[0]) * 100 + ${ABOVE_EXACT[amount]}).toFixed(2)}` },
    // A Maestro expression, not a JS template.
    // eslint-disable-next-line no-template-curly-in-string
    { inputText: '${output.amount}' },
  ];
}

/**
 * The Maestro flow for one create-token scenario, each step of the graph's path one labelled group.
 *
 * @param {{ id: string, values: object }} scenario from the graph
 * @param {{ id: string, at: string, message: string, kind: string }} outcome the expected outcome
 * @param {{ name: string, symbol: string, pinUrl?: string }} token what to type, and where the
 *   runner taps the PIN (lib/flowSteps.js)
 */
function buildCreateTokenFlow(scenario, outcome, { name, symbol, pinUrl }) {
  const { values } = scenario;
  const success = outcome.kind === 'success';
  const stopAt = success ? STEP_ORDER.length : STEP_ORDER.indexOf(outcome.at);
  const groups = [];
  const group = (step, text, commands) => groups.push({
    runFlow: { label: `${STEP_ORDER.indexOf(step) + 1}/${STEP_ORDER.length} ${step}: ${text}`, commands },
  });
  // A step whose own outcome is "Next stays disabled" ends before Next is tapped.
  const next = (step, id) => (STEP_ORDER.indexOf(step) < stopAt ? [tap(id)] : []);

  group('type', `pick the ${values.token} token`, [
    tap('tab-settings'),
    { scrollUntilVisible: { element: 'Create a new token', direction: 'DOWN', timeout: 20000 } },
    { tapOn: 'Create a new token' },
    waitFor({ id: `create-token-type-${values.token}` }),
    tap(`create-token-type-${values.token}`),
    waitFor({ id: 'create-token-name' }),
  ]);
  group('name', values.naming === 'empty-name' ? 'leave it empty' : `type ${name}`, [
    ...(values.naming === 'empty-name' ? [] : [tap('create-token-name'), { inputText: name }]),
    ...next('name', 'create-token-name-next'),
  ]);
  if (stopAt > STEP_ORDER.indexOf('name')) {
    const typed = values.naming === 'short-symbol' ? symbol[0] : symbol;
    group('symbol', `type ${typed}`, [
      waitFor({ id: 'create-token-symbol' }),
      tap('create-token-symbol'),
      { inputText: typed },
      ...next('symbol', 'create-token-symbol-next'),
    ]);
  }
  if (stopAt > STEP_ORDER.indexOf('symbol')) {
    group('amount', `type the ${values['mint-amount']} amount`, [
      waitFor({ id: AVAILABLE }),
      ...fundingCheck(values.funding),
      ...amountSteps(values['mint-amount']),
      ...next('amount', 'create-token-amount-next'),
    ]);
  }
  if (stopAt > STEP_ORDER.indexOf('amount')) {
    group('confirm', 'check the summary and tap Create token', [
      waitFor({ id: 'create-token-confirm' }),
      { assertVisible: name },
      { assertVisible: symbol },
      { assertVisible: values.token === 'deposit' ? 'Deposit' : 'Network fee' },
      ...(values.token === 'fee' ? [{ assertVisible: '0.01 HTR' }] : []),
      tap('create-token-confirm'),
    ]);
    group('authorize', 'enter the PIN', pinSteps(pinUrl));
  }

  const expected = outcome.message.replace(/\*\*/g, '').replace(/\$\{([^}]+)\}/g, '<$1>');
  const check = outcome.message.startsWith('Next stays disabled')
    ? { assertVisible: { id: `create-token-${outcome.at}-next`, enabled: false } }
    : waitFor(messagePattern(outcome.message), 60000);
  groups.push({ runFlow: { label: `expect ${outcome.id}: ${expected}`, commands: [check, ...(success ? [] : [reachedStep(outcome)])] } });
  if (success) {
    group('detail', 'check the new token\'s details', [
      // The success modal has no button: it closes on a tap on its backdrop (README "Selectors").
      { tapOn: { point: '50%,10%' } },
      waitFor({ id: 'token-details-config' }),
      { assertVisible: values.token === 'deposit' ? 'Fee Model: Deposit-Based' : 'Fee Model: Fee-Based' },
      { copyTextFrom: { id: 'token-details-config' } },
      // The runner reads the token's uid from this line.
      // eslint-disable-next-line no-template-curly-in-string
      { evalScript: '${console.log("E2E_TOKEN " + maestro.copiedText)}' },
      reachedStep(outcome),
    ]);
  }
  groups.push(backGroup());
  const yaml = (doc) => YAML.stringify(doc, { lineWidth: 0 });
  return `${yaml({ appId: 'network.hathor.wallet', name: scenario.id })}---\n${yaml(groups)}`;
}

module.exports = { buildCreateTokenFlow };
