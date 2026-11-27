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
import { JOBS } from '../../QA/e2e/lib/jobs';
import { PRIVNETS } from '../../QA/e2e/lib/app';
import { modesAre } from '../../QA/e2e/lib/addressModeScenarios';

const graph = loadGraph(path.join(__dirname, '..', '..', 'QA', 'graph', 'graph.yaml'));
const option = (mode, checked, enabled = true) => ({ id: `address-mode-${mode}`, checked, enabled });

describe('reading Address Mode', () => {
  it('passes the mode selected, with Single offered or not', () => {
    expect(() => modesAre([option('single', true), option('multi', false)], 'single', true)).not.toThrow();
    expect(() => modesAre([option('single', false, false), option('multi', true)], 'multi', false)).not.toThrow();
  });

  it('says what differs', () => {
    expect(() => modesAre([option('single', true), option('multi', false)], 'multi', true))
      .toThrow('Single is selected; Multi is not selected');
    expect(() => modesAre([option('single', false), option('multi', true)], 'multi', false))
      .toThrow('Single is offered');
  });
});

describe('the address-mode jobs', () => {
  it('run on the plain privnet, after every job of the shielded one', () => {
    const plain = JOBS.filter((job) => job.privnet === 'plain');
    expect(plain.map(({ id, setup }) => `${id} ${setup}`)).toEqual([
      'fn/address-mode pnp-fn-seed-single', 'ws/address-mode pnp-ws-seed-single',
    ]);
    expect(JOBS.slice(-plain.length)).toEqual(plain);
    expect(Object.keys(PRIVNETS).sort()).toEqual(['plain', 'shielded']);
    expect(PRIVNETS.plain.name).not.toBe(PRIVNETS.shielded.name);
  });

  it('have one scenario a setup, on a wallet that starts single', () => {
    JOBS.filter((job) => job.privnet === 'plain').forEach((job) => {
      const plan = planScenarios(graph, job);
      expect(plan).toHaveLength(1);
      expect(graph.setups.find(({ id }) => id === job.setup).values.addr).toBe('single');
    });
  });
});
