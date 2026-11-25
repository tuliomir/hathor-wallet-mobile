/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import {
  shown, units, lockedCount, shortId, feesOf, rowOf,
} from '../../QA/e2e/lib/book';

describe('what the app should show', () => {
  it('writes units as the app does, and reads them back', () => {
    expect([0n, 5n, 100n, 123456n, 1234567890n, -4n].map(shown))
      .toEqual(['0.00', '0.05', '1.00', '1,234.56', '12,345,678.90', '-0.04']);
    expect(units('1,234.56')).toBe(123456n);
  });

  it('counts locked outputs in the app\'s words, and shortens ids as it does', () => {
    expect(lockedCount(1)).toBe('1 private output is locked');
    expect(lockedCount(2)).toBe('2 private outputs are locked');
    expect(shortId(`1234567${'0'.repeat(50)}abcdefg`)).toBe('1234567...abcdefg');
  });

  it('splits a transaction\'s HTR fees into privacy and network', () => {
    const tx = {
      fees: [{ token_uid: '00', amount: 5 }, { token_uid: 'ab', amount: 900 }],
      shielded_outputs: [{ mode: 2, asset_commitment: 'xx' }, { mode: 1 }],
    };
    expect(feesOf(tx)).toEqual({ total: 5n, privacy: 3n, network: 2n });
    expect(feesOf({})).toEqual({ total: 0n, privacy: 0n, network: 0n });
  });

  it('gives the row of each kind of transaction, the fee counting only in HTR', () => {
    const htr = { uid: '00', symbol: 'HTR', amount: 150n, fee: 4n };
    const custom = { ...htr, uid: 'ab', symbol: 'TKN' };
    const row = (tx, entry) => {
      const { description, amount } = rowOf({ ...tx, entry });
      return `${description} ${amount}`;
    };
    expect(row(htr, 'received')).toBe('Received HTR 1.50');
    expect(row(htr, 'sent')).toBe('Sent HTR -1.54');
    expect(row(htr, 'self')).toBe('Sent HTR -0.04');
    expect(row({ ...htr, fee: 0n }, 'self')).toBe('You sent HTR to yourself 0.00');
    expect(row(custom, 'sent')).toBe('Sent TKN -1.50');
    expect(row(custom, 'self')).toBe('You sent TKN to yourself 0.00');
  });
});
