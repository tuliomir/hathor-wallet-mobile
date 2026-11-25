/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import { payAgain } from '../../QA/e2e/lib/payAgain';

const SAME_SECOND = 'http://localhost:13020/fund: 500 {"message":"full validation failed: tx=0060 timestamp=1795624909, parent=000d timestamp=1795624909"}';

function failing(times, message) {
  const calls = { count: 0 };
  return [calls, async () => {
    calls.count += 1;
    if (calls.count <= times) throw new Error(message);
    return 'paid';
  }];
}

describe('a payment made too soon after another', () => {
  it('is tried again, and no more than it is told to', async () => {
    const [calls, pay] = failing(2, SAME_SECOND);
    expect(await payAgain(pay, { pause: 0 })).toBe('paid');
    expect(calls.count).toBe(3);
    const [always, never] = failing(9, SAME_SECOND);
    await expect(payAgain(never, { pause: 0, tries: 3 })).rejects.toThrow('timestamp');
    expect(always.count).toBe(3);
  });

  it('is not what any other failure is: those are told at once', async () => {
    const [calls, pay] = failing(1, 'full validation failed: shielded balance equation does not hold');
    await expect(payAgain(pay, { pause: 0 })).rejects.toThrow('shielded');
    expect(calls.count).toBe(1);
  });
});
