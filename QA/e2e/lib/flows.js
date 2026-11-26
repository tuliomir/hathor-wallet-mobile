/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// How each action's scenarios run: by a Maestro flow a builder writes, or by the runner over adb.

const crypto = require('crypto');
const sendFlow = require('./sendFlow');
const createTokenFlow = require('./createTokenFlow');
const walletStart = require('./walletStart');

const ACTIONS = ['send', 'create-token', 'start-wallet', 'receive', 'receive-payment', 'history', 'register-token', 'reset-import'];

// The kit's files only these actions' scenarios go through, whose change reaches nothing else. The
// builders of Maestro flows aren't here: the flow they write for a scenario says more.
const ACTION_FILES = {
  receive: ['QA/e2e/lib/receiveScenarios.js', 'QA/e2e/tools/qr.js'],
  'receive-payment': ['QA/e2e/lib/historyScenarios.js', 'QA/e2e/lib/book.js'],
  history: ['QA/e2e/lib/historyScenarios.js', 'QA/e2e/lib/book.js'],
  'register-token': ['QA/e2e/lib/registerScenarios.js'],
  'reset-import': ['QA/e2e/lib/resetScenarios.js'],
};

/** The facade a start-wallet scenario ends on. */
const facadeOf = (scenario, outcome) => (
  outcome.id === 'edge-fallback' ? 'fullnode' : scenario.values.facade);

const TOKEN = { name: '<name>', symbol: '<symbol>' };

/** A scenario's Maestro flow with what differs from run to run left out, or '' when it has none. */
function flowOf(scenario, outcome, token = TOKEN) {
  const build = {
    send: () => sendFlow.buildSendFlow(scenario, outcome, { address: '<address>', token, pinUrl: '<pin>' }),
    'create-token': () => createTokenFlow.buildCreateTokenFlow(scenario, outcome, { ...TOKEN, pinUrl: '<pin>' }),
    'start-wallet': () => walletStart.buildServerFlow(facadeOf(scenario, outcome)),
  }[scenario.action];
  return build ? build() : '';
}

const digest = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);

module.exports = {
  ACTIONS, ACTION_FILES, facadeOf, flowOf, digest,
};
