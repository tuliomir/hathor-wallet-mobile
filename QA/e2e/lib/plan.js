/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The scenarios of one run of run.js, each with the outcome it must reach.

const { allScenarios } = require('../../graph/tools/scenarios');
const { createdTokenOutcome } = require('./createdTokens');
const { runOrder } = require('./runOrder');
const { unrunnableReason } = require('./unrunnable');

/**
 * @param {object} graph
 * @param {{ setup: string, action: string, createdTokens?: boolean, unlocked?: boolean }} run
 * @returns {{ scenario: object, outcome: object, skip: string|null }[]} in the order they run
 */
function planScenarios(graph, { setup, action: actionId, createdTokens, unlocked, }) {
  const action = graph.actions.find(({ id }) => id === actionId);
  if (!action) throw new Error(`the graph has no action ${actionId}`);
  const outcomes = Object.fromEntries(action.path.outcomes.map((o) => [o.id, o]));
  const only = {};
  if (unlocked) only['private-balance'] = ['unlocked'];
  if (createdTokens) {
    only.token = ['deposit', 'fee'];
    // 2^40 units need a deposit of 110M HTR; the minted tokens cover that amount.
    only.amount = ['normal', 'max', 'over-balance', 'empty', 'decimals'];
  }
  const narrowed = {
    ...graph,
    actions: [action],
    axes: graph.axes.map((axis) => (only[axis.id]
      ? { ...axis, values: axis.values.filter((v) => only[axis.id].includes(v.id)) } : axis)),
  };
  // An action that doesn't vary the private balance runs on an unlocked wallet, the runner's
  // first; the runner, the suite and the dashboard group scenarios by that state.
  const stated = (scenario) => (scenario.values['private-balance'] ? scenario : {
    ...scenario, values: { ...scenario.values, 'private-balance': 'unlocked' },
  });
  const own = allScenarios(narrowed).filter((s) => s.setup === setup).map(stated);
  return runOrder(own.map((scenario) => {
    const outcome = outcomes[scenario.expected[0]];
    return {
      scenario,
      skip: unrunnableReason(scenario),
      outcome: createdTokens ? createdTokenOutcome(scenario, outcome, outcomes) : outcome,
    };
  }));
}

module.exports = { planScenarios };
