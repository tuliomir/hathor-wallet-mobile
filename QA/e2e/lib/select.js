/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Which scenarios a run needs, from what each last passed with.
//
// A change reaches a scenario directly when it is to the scenario's own flow, checks or
// expectation, or to the files of the feature its action exercises or of a feature that brings one
// of its action values (a locked private balance): it is `changed`. Everything else the graph ties
// to the scenario, the shared parts of the kit, and the app's files no feature lists reach it
// indirectly: it is `owed`. forDev says what of these a `dev` run takes; the rest stays owed, and
// listed, until a full run.

const { computeImpact } = require('../../graph/tools/impact');

const asList = (value) => (Array.isArray(value) ? value : []);

/** For each scenario id, the features that reach it: { direct: [id], indirect: [id] }. */
function reachOf(graph, scenarios) {
  const actionAxes = new Set(asList(graph.axes).filter((axis) => axis.kind === 'action').map(({ id }) => id));
  const featureOf = Object.fromEntries(asList(graph.actions).map((a) => [a.id, a.feature]));
  const reach = Object.fromEntries(scenarios.map((s) => [s.id, { direct: [], indirect: [] }]));
  asList(graph.features).filter((feature) => asList(feature.files).length).forEach((feature) => {
    const introduced = asList(feature.introduces).map((key) => key.split(':'))
      .filter(([axis]) => actionAxes.has(axis));
    computeImpact(graph, { type: 'feature', id: feature.id }, scenarios).scenarios.forEach((s) => {
      const direct = featureOf[s.action] === feature.id
        || introduced.some(([axis, value]) => s.values[axis] === value);
      reach[s.id][direct ? 'direct' : 'indirect'].push(feature.id);
    });
  });
  return reach;
}

/** What a scenario is run with now, as its ledger entry keeps it. */
function currentOf({ scenario, outcome, flow }, ids, reach) {
  const { direct, indirect } = reach[scenario.id];
  return {
    flow,
    outcome: outcome.id,
    checks: ids.actions[scenario.action] || null,
    features: Object.fromEntries([...direct, ...indirect].sort()
      .map((id) => [id, ids.features[id]])),
    app: ids.app,
    kit: ids.kit,
  };
}

/**
 * Where a scenario stands: `new`, `failed`, `changed` (directly), `owed` or `fresh`, and why. With
 * `lacksKit`, the entry is of a commit without the kit, which says nothing of flows and checks.
 */
function standing(entry, current, reach, { lacksKit = false } = {}) {
  if (!entry) return { state: 'new', why: ['never ran'] };
  if (entry.status && entry.status !== 'passed') return { state: 'failed', why: [`last ${entry.status}`] };
  const why = [];
  if (!lacksKit) {
    if (entry.flow !== current.flow) why.push('its flow');
    if (entry.outcome !== current.outcome) why.push('its expectation');
    if (entry.checks !== current.checks) why.push('its checks');
  }
  // Its own: a scenario of which the test changed, not only the app.
  const own = why.length > 0;
  const differs = (id) => entry.features[id] !== current.features[id];
  why.push(...reach.direct.filter(differs).map((id) => `feature ${id}`));
  if (why.length) return { state: 'changed', why, own };
  why.push(...reach.indirect.filter(differs).map((id) => `feature ${id}`));
  if (entry.app !== current.app) why.push('app files no feature lists');
  if (!lacksKit && entry.kit !== current.kit) why.push('shared parts of the kit');
  return why.length ? { state: 'owed', why } : { state: 'fresh', why };
}

/**
 * Whether a scenario needs nothing of a run: `fresh`, or `skipped`, one the kit can't run yet
 * (lib/unrunnable.js), which a run would only list again.
 */
const settled = (row) => ['fresh', 'skipped'].includes(row.standing.state);

/**
 * What `dev` runs, and what that leaves owed.
 * - A scenario that is new, failed, or whose own test changed runs.
 * - One whose feature's files changed runs on the fullnode (a job with `primary`); on the wallet
 *   service and with created tokens a sample of them does.
 * - A job with none of these runs a sample of what it owes, if it owes anything.
 * With `all`, every changed scenario runs; with `quick`, only a sample of each job.
 * @param {{ job: object, scenario: object, standing: { state: string } }[]} rows
 * @param {(rows: object[]) => object[]} pick the sample of one job's rows
 * @param {{ all?: boolean, quick?: boolean }} [options]
 */
function forDev(rows, pick, { all, quick } = {}) {
  const jobs = [...new Set(rows.map((row) => row.job.id))];
  const run = jobs.flatMap((id) => {
    const ofJob = rows.filter((row) => row.job.id === id);
    const stale = ofJob.filter((row) => !settled(row));
    const sampleOf = (from) => (from.length ? pick(from) : []);
    if (quick) return sampleOf(stale);
    const changed = stale.filter((row) => row.standing.state !== 'owed');
    const byFeature = changed.filter((row) => row.standing.state === 'changed' && !row.standing.own);
    const must = changed.filter((row) => !byFeature.includes(row));
    const featured = all || ofJob[0].job.primary ? byFeature : sampleOf(byFeature);
    const needed = ofJob.filter((row) => must.includes(row) || featured.includes(row));
    if (needed.length) return needed;
    return sampleOf(stale);
  });
  return { run, owed: rows.filter((row) => !settled(row) && !run.includes(row)) };
}

module.exports = {
  reachOf, currentOf, standing, forDev, settled,
};
