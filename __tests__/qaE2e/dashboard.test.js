/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import { htrOnDashboard, numpadKeys } from '../../QA/e2e/lib/dashboard';

const dump = (...texts) => texts.map((text) => `<node index="0" text="${text}" resource-id="" />`).join('');

describe('htrOnDashboard', () => {
  it('reads the balance of the HTR row', () => {
    expect(htrOnDashboard(dump('Tokens', 'Hathor', '7.00', 'HTR', 'E2E Fee', '1,000.00', 'E2EF'))).toBe(700n);
    expect(htrOnDashboard(dump('Hathor', '1,020.50', 'HTR'))).toBe(102050n);
    expect(htrOnDashboard(dump('Hathor', '0.00', 'HTR'))).toBe(0n);
  });

  it('is null on another screen, or while the balance loads', () => {
    expect(htrOnDashboard(dump('SEND TOKENS', 'Next'))).toBeNull();
    expect(htrOnDashboard(dump('Hathor', '', 'HTR'))).toBeNull();
    expect(htrOnDashboard(dump('You have', '20.00', 'HTR'))).toBeNull();
    expect(htrOnDashboard('')).toBeNull();
  });
});

describe('numpadKeys', () => {
  it('reads each key\'s centre', () => {
    const node = (digit, bounds) => `{ "attributes" : { "text" : "", "resource-id" : "numpad-key-${digit}", "clickable" : "true", "bounds" : "${bounds}" } }`;
    expect(numpadKeys(node(1, '[49,1585][374,1732]') + node(0, '[374,2080][706,2227]'))).toEqual({
      1: ['212', '1659'], 0: ['540', '2154'],
    });
    expect(numpadKeys('{}')).toEqual({});
  });
});
