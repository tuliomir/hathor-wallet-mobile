/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The smoke set: what runs before a push, and the sample `dev` takes of what it would otherwise
// leave owed.

/**
 * The smoke scenarios of one job. Each row has `scenario` ({ id, action, values }) and `outcome`
 * ({ kind: 'success' | 'error' }); return the rows to run, at least one.
 *
 * TODO(owner): this rule is a placeholder, the first success and the first error of the job. What
 * it trades off: one scenario costs about 75 s, a private balance state other than `unlocked` about
 * 4 min of setup on top, and whatever isn't here first runs in the next full run.
 */
function smokeOf(rows) {
  const unlocked = rows.filter(({ scenario }) => scenario.values['private-balance'] === 'unlocked');
  const from = unlocked.length ? unlocked : rows;
  const first = (kind) => from.find(({ outcome }) => (outcome.kind === 'success') === (kind === 'success'));
  return [...new Set([first('success'), first('error')].filter(Boolean))];
}

module.exports = { smokeOf };
