/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import { tokenPlan } from '../../QA/e2e/lib/tokenPlan';

const entry = (id, token, amount, kind = 'success') => ({
  scenario: { id, values: { token, amount } }, outcome: { kind },
});

describe('token plan', () => {
  it('shares a token between the sends that leave some of it', () => {
    const { tokens, keyOf } = tokenPlan([entry('a', 'deposit', 'normal'), entry('b', 'deposit', 'decimals'), entry('c', 'fee', 'normal')]);
    expect(keyOf).toEqual({ a: 'deposit', b: 'deposit', c: 'fee' });
    expect(Object.keys(tokens)).toEqual(['deposit', 'fee']);
  });

  it('gives each send that empties its token one of its own', () => {
    const { tokens, keyOf } = tokenPlan([
      entry('a', 'deposit', 'max'), entry('b', 'fee', 'max'), entry('c', 'deposit', 'private-over-limit'),
    ]);
    expect(new Set(Object.values(keyOf)).size).toBe(3);
    expect(tokens[keyOf.a]).toMatchObject({ kind: 'deposit', units: '100000' });
    expect(tokens[keyOf.b]).toMatchObject({ kind: 'fee', units: '100000' });
    expect(tokens[keyOf.c]).toMatchObject({ kind: 'deposit', units: String(2 ** 40) });
    const symbols = Object.values(tokens).map(({ symbol }) => symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    symbols.forEach((symbol) => expect(symbol.length).toBeLessThanOrEqual(5));
  });

  it('shares tokens between the sends that fail, whatever their amount', () => {
    const { tokens, keyOf } = tokenPlan([
      entry('a', 'deposit', 'max', 'error'), entry('b', 'deposit', 'private-over-limit', 'error'), entry('c', 'fee', 'private-over-limit', 'error'),
    ]);
    expect(keyOf).toEqual({ a: 'deposit', b: 'depositLarge', c: 'feeLarge' });
    expect(tokens.feeLarge).toMatchObject({ kind: 'fee', units: String(2 ** 40) });
  });

  it('makes nothing for HTR', () => {
    const { tokens, keyOf } = tokenPlan([entry('a', 'htr', 'max')]);
    expect(keyOf).toEqual({ a: 'htr' });
    expect(Object.keys(tokens)).toEqual(['deposit', 'fee']);
  });
});
