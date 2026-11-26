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
import { RANDOM_WORDS } from '../../QA/e2e/lib/resetScenarios';

const graph = loadGraph(path.join(__dirname, '..', '..', 'QA', 'graph', 'graph.yaml'));
// eslint-disable-next-line import/no-extraneous-dependencies
const wordlist = require('bitcore-mnemonic').Words.ENGLISH;

describe('the reset-import scenarios', () => {
  it('are one a setup, run on an unlocked wallet, and end on the token import', () => {
    ['pn-fn-seed-multi', 'pn-ws-seed-multi'].forEach((setup) => {
      const plan = planScenarios(graph, { setup, action: 'reset-import' });
      expect(plan.map(({ scenario }) => scenario.id)).toEqual([`reset-import:${setup}`]);
      expect(plan[0].skip).toBeNull();
      expect(plan[0].scenario.values['private-balance']).toBe('unlocked');
      expect(plan[0].outcome.id).toBe('ok-imported');
    });
  });

  it('type 24 random words, none of them a word the wallet knows', () => {
    expect(RANDOM_WORDS).toHaveLength(24);
    RANDOM_WORDS.forEach((word) => expect(wordlist).not.toContain(word));
    // adb's input text needs no escaping for them.
    RANDOM_WORDS.forEach((word) => expect(word).toMatch(/^[a-z]+$/));
  });
});
