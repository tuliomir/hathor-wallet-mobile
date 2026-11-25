/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The outcome to expect from a scenario whose token was created in the app, in place of the
 * graph's, which doesn't say where a token came from. The app mints to one of its shielded spend
 * addresses, and with a broken key wallet-lib doesn't use those, so the app shows none of the
 * token (ROADMAP "Findings").
 *
 * @param {{ values: object }} scenario from the graph
 * @param {{ kind: string }} outcome the one the graph expects
 * @param {Object<string, object>} outcomes the action's, by id
 */
function createdTokenOutcome({ values }, outcome, outcomes) {
  if (values['private-balance'] !== 'broken-key' || outcome.kind !== 'success') return outcome;
  return outcomes[values.amount === 'max' ? 'err-invalid-amount' : 'err-insufficient-funds'];
}

module.exports = { createdTokenOutcome };
