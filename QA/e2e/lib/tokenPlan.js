/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The custom tokens a group of send scenarios needs. Scenarios share E2ED and E2EF (1000.00 each)
// and, for the amounts over the private limit, E2EL and E2EX (2^40 units each: a balance above it
// would make a private send of the whole balance fail that limit before the fee check). A send
// that empties its token gets one of its own.

const OVER_LIMIT = String(2 ** 40);
const SHARED = {
  deposit: { kind: 'deposit', name: 'E2E Deposit', symbol: 'E2ED', units: '100000' },
  fee: { kind: 'fee', name: 'E2E Fee', symbol: 'E2EF', units: '100000' },
  depositLarge: { kind: 'deposit', name: 'E2E Large', symbol: 'E2EL', units: OVER_LIMIT },
  feeLarge: { kind: 'fee', name: 'E2E Fee Large', symbol: 'E2EX', units: OVER_LIMIT },
};

/**
 * @param {{ scenario: { id: string, values: object }, outcome: { kind: string } }[]} plan
 * @returns {{ tokens: object, keyOf: object }} the tokens to make, by key, and each scenario's key
 */
function tokenPlan(plan) {
  const tokens = { deposit: SHARED.deposit, fee: SHARED.fee };
  const keyOf = {};
  plan.forEach(({ scenario: { id, values }, outcome }) => {
    const { token, amount } = values;
    if (token === 'htr') {
      keyOf[id] = 'htr';
      return;
    }
    const large = amount === 'private-over-limit';
    if (outcome.kind === 'success' && (large || amount === 'max')) {
      const n = String(Object.keys(tokens).filter((key) => key.startsWith('own')).length + 1).padStart(2, '0');
      keyOf[id] = `own${n}`;
      tokens[keyOf[id]] = {
        kind: token, name: `E2E Own ${n}`, symbol: `EO${n}`, units: large ? OVER_LIMIT : SHARED[token].units,
      };
      return;
    }
    keyOf[id] = large ? `${token}Large` : token;
    tokens[keyOf[id]] = SHARED[keyOf[id]];
  });
  return { tokens, keyOf };
}

module.exports = { tokenPlan };
