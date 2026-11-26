/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import path from 'path';
import { loadGraph } from '../../QA/graph/tools/load';
import { planScenarios } from '../../QA/e2e/lib/plan';
import { feeModelOf } from '../../QA/e2e/lib/registerScenarios';

const graph = loadGraph(path.join(__dirname, '..', '..', 'QA', 'graph', 'graph.yaml'));

describe('the fee model a token\'s details show', () => {
  it('follows the token\'s version on the fullnode', () => {
    expect(feeModelOf(1)).toBe('Fee Model: Deposit-Based');
    expect(feeModelOf(2)).toBe('Fee Model: Fee-Based');
  });

  it('refuses a version it has no text for, rather than expect none', () => {
    expect(() => feeModelOf(0)).toThrow('version 0');
    expect(() => feeModelOf(undefined)).toThrow('version undefined');
  });
});

describe('the register-token scenarios of a setup', () => {
  const plan = planScenarios(graph, { setup: 'pn-ws-seed-multi', action: 'register-token' });
  const ids = (rows) => rows.map(({ scenario }) => scenario.id.split(':').pop());

  it('are the deposit and the fee token, pasted and scanned', () => {
    expect(ids(plan).sort()).toEqual(['deposit.manual', 'deposit.qr', 'fee.manual', 'fee.qr']);
  });

  it('skip the scans, with the reason, and run the pasted ones', () => {
    expect(ids(plan.filter((p) => !p.skip)).sort()).toEqual(['deposit.manual', 'fee.manual']);
    plan.filter((p) => p.skip).forEach((p) => expect(p.skip).toMatch(/camera helper/));
  });

  it('run on an unlocked wallet, as the action has no private balance axis', () => {
    plan.forEach((p) => expect(p.scenario.values['private-balance']).toBe('unlocked'));
  });
});
