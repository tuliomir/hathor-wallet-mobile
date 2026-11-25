/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// What each scenario last passed or failed with. `ledger.json` is committed, written by full runs
// only: the baseline of a fresh checkout. The local one, git-ignored, is written by every run.

const fs = require('fs');
const path = require('path');

const E2E = path.join(__dirname, '..');
const COMMITTED = path.join(E2E, 'ledger.json');
const LOCAL = path.join(E2E, 'evidence', 'ledger.local.json');

const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

/** The newest entry of each scenario, of the two ledgers. */
function merged(committed, local) {
  const entries = { ...committed };
  Object.entries(local).forEach(([key, entry]) => {
    if (!entries[key] || entries[key].at <= entry.at) entries[key] = entry;
  });
  return entries;
}

const load = () => merged(read(COMMITTED), read(LOCAL));

function write(file, entries) {
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
}

/** Adds one scenario's result to the local ledger, right away: a run may die before its end. */
function record(key, entry) {
  write(LOCAL, { ...read(LOCAL), [key]: entry });
}

/** Makes a full run's results the committed baseline; scenarios that no longer exist leave it. */
function commitBaseline(keys, since) {
  const local = read(LOCAL);
  const missing = keys.filter((key) => !local[key] || local[key].at < since);
  if (missing.length) throw new Error(`the full run has no result for ${missing.join(', ')}`);
  write(COMMITTED, Object.fromEntries(keys.map((key) => [key, local[key]])));
}

module.exports = { load, merged, record, commitBaseline, COMMITTED };
