/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Flows around a wallet start: what Receive says of the private balance, and the
// server Settings shows.

// eslint-disable-next-line import/no-extraneous-dependencies
const YAML = require('yaml');

const SERVERS = { fullnode: '.*localhost:18083.*', 'wallet-service': '.*localhost:18300.*' };
const RECEIVE_SAYS = { locked: 'Private receiving is locked', 'broken-key': 'Private receiving is unavailable' };

const flow = (name, commands) => `${YAML.stringify({ appId: 'network.hathor.wallet', name })}---\n${YAML.stringify(commands, { lineWidth: 0 })}`;

/** Waits for the unlocked app's dashboard, and checks the private balance state on Receive. */
function buildStartedFlow(state) {
  return flow(`start with the private balance ${state}`, [
    { extendedWaitUntil: { visible: 'Nano Contracts', timeout: 120000 } },
    ...(RECEIVE_SAYS[state] ? [
      { tapOn: { id: 'tab-receive' } },
      { extendedWaitUntil: { visible: RECEIVE_SAYS[state], timeout: 60000 } },
      { tapOn: { id: 'tab-home' } },
      { extendedWaitUntil: { visible: 'Nano Contracts', timeout: 15000 } },
    ] : []),
  ]);
}

/** Checks the server at the bottom of Settings, which keeps its scroll: back up after. */
function buildServerFlow(facade) {
  return flow(`the app is on the ${facade}`, [
    { tapOn: { id: 'tab-settings' } },
    { scrollUntilVisible: { element: SERVERS[facade], direction: 'DOWN', timeout: 30000 } },
    { scrollUntilVisible: { element: 'You are connected to', direction: 'UP', timeout: 30000 } },
    { tapOn: { id: 'tab-home' } },
  ]);
}

/** Registers the custom tokens minted for the wallet, through the dashboard's banner. */
function buildImportFlow(names) {
  const pick = (name) => [
    { scrollUntilVisible: { element: name, direction: 'DOWN', timeout: 20000, centerElement: true } },
    { tapOn: name },
  ];
  return flow('import the minted tokens', [
    { extendedWaitUntil: { visible: 'Import tokens', timeout: 60000 } },
    // The link is a Text inside the banner's Text, with no view of its own for a testID.
    { tapOn: 'Import tokens' },
    { extendedWaitUntil: { visible: `Tokens found \\(${names.length}\\)`, timeout: 30000 } },
    ...names.flatMap(pick),
    { tapOn: { id: 'import-tokens-continue' } },
    { extendedWaitUntil: { visible: 'Confirm Import', timeout: 15000 } },
    { tapOn: { id: 'confirm-import-tokens' } },
    { extendedWaitUntil: { visible: 'New tokens added!', timeout: 30000 } },
    { tapOn: { id: 'import-tokens-see-all' } },
    { extendedWaitUntil: { visible: 'Nano Contracts', timeout: 15000 } },
  ]);
}

module.exports = { buildStartedFlow, buildServerFlow, buildImportFlow, RECEIVE_SAYS };
