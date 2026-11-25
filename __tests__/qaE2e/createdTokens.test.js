/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import { createdTokenOutcome } from '../../QA/e2e/lib/createdTokens';

const outcomes = {
  'ok-sent': { id: 'ok-sent', kind: 'success' },
  'err-invalid-amount': { id: 'err-invalid-amount', kind: 'error' },
  'err-insufficient-funds': { id: 'err-insufficient-funds', kind: 'error' },
  'err-fee': { id: 'err-fee', kind: 'error' },
};
const expected = (state, amount, graph) => createdTokenOutcome(
  { values: { 'private-balance': state, amount } },
  outcomes[graph],
  outcomes,
).id;

describe('the outcome of a send of a token created in the app', () => {
  it('is the graph\'s unless the key is broken', () => {
    expect(expected('unlocked', 'normal', 'ok-sent')).toBe('ok-sent');
    expect(expected('locked', 'max', 'ok-sent')).toBe('ok-sent');
  });

  it('is what a balance of zero gives with a broken key', () => {
    expect(expected('broken-key', 'normal', 'ok-sent')).toBe('err-insufficient-funds');
    expect(expected('broken-key', 'decimals', 'ok-sent')).toBe('err-insufficient-funds');
    expect(expected('broken-key', 'max', 'ok-sent')).toBe('err-invalid-amount');
    expect(expected('broken-key', 'normal', 'err-fee')).toBe('err-fee');
  });
});
