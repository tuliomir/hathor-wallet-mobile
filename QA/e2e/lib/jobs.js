/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The whole suite, as the runs of run.js it is made of: one action on one setup each. A job's id
// is what the suite's commands and status call it.

const SETUPS = { fn: 'pn-fn-seed-multi', ws: 'pn-ws-seed-multi' };
// The plain privnet's (lib/app.js PRIVNETS), for what the shielded one hides.
const PLAIN = { fn: 'pnp-fn-seed-single', ws: 'pnp-ws-seed-single' };
const RUNS = [
  { name: 'receive', action: 'receive' },
  { name: 'receive-payment', action: 'receive-payment' },
  { name: 'history', action: 'history' },
  { name: 'send', action: 'send' },
  { name: 'send-created', action: 'send', createdTokens: true },
  { name: 'create-token', action: 'create-token' },
  { name: 'start-wallet', action: 'start-wallet' },
  { name: 'register-token', action: 'register-token' },
  { name: 'reset-import', action: 'reset-import' },
  { name: 'settings', action: 'settings' },
  { name: 'address-mode', action: 'address-mode', privnet: 'plain' },
];

// The plain privnet's jobs after all the others: a run switches privnets once at most.
const onPlain = (job) => job.privnet === 'plain';
const ALL = Object.entries(SETUPS).flatMap(([facade, setup]) => RUNS.map((run) => ({
  id: `${facade}/${run.name}`,
  setup: run.privnet === 'plain' ? PLAIN[facade] : setup,
  privnet: run.privnet || 'shielded',
  action: run.action,
  createdTokens: Boolean(run.createdTokens),
  // Where `dev` runs all that a feature's change reaches (lib/select.js).
  primary: facade === 'fn' && !run.createdTokens,
})));
const JOBS = [...ALL.filter((job) => !onPlain(job)), ...ALL.filter(onPlain)];

/**
 * The jobs a comma-separated list names: a job's id, a facade (`fn`, `ws`) or a run's name on both
 * (`history`). Without a list, all of them.
 */
function jobsOf(list) {
  if (!list) return JOBS;
  const names = list.split(',');
  names.forEach((name) => {
    if (!JOBS.some(({ id }) => id === name || id.split('/').includes(name))) {
      throw new Error(`no job is named '${name}'; there are ${JOBS.map(({ id }) => id).join(', ')}`);
    }
  });
  return JOBS.filter(({ id }) => names.some((name) => id === name || id.split('/').includes(name)));
}

/** A scenario's key in the ledger: sends of created tokens share the ids of the plain sends. */
const keyOf = (scenario, createdTokens) => `${createdTokens ? 'created:' : ''}${scenario.id}`;

module.exports = { JOBS, jobsOf, keyOf };
