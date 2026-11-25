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
import { allScenarios } from '../../QA/graph/tools/scenarios';
import { pickOf, picksOfFiles, affectedIds } from '../../QA/e2e/lib/affected';

const graph = loadGraph(path.join(__dirname, '..', 'qaGraph', 'fixtures', 'mini.yaml'));
const withFiles = {
  ...graph,
  features: graph.features.map((f) => ({ ...f, files: f.id === 'send-f' ? ['src/send/', 'src/Send.js'] : [] })),
};

describe('affected scenarios', () => {
  it('reads a feature, a flag by id or name, and an axis value', () => {
    expect(pickOf(graph, 'pin-f')).toEqual({ type: 'feature', id: 'pin-f' });
    expect(pickOf(graph, 'fbt')).toEqual({ type: 'flag', id: 'fbt' });
    expect(pickOf(graph, 'fee-based-tokens.rollout')).toEqual({ type: 'flag', id: 'fbt' });
    expect(pickOf(graph, 'token:fee')).toEqual({ type: 'axisValue', id: 'token:fee' });
  });

  it('refuses a name the graph does not have, rather than run nothing', () => {
    expect(() => pickOf(graph, 'nope')).toThrow('nope');
    expect(() => affectedIds(graph, [pickOf(graph, 'token:nope')], allScenarios(graph))).toThrow('nope');
  });

  it('picks the features of the changed files, and names the app files no feature lists', () => {
    const files = ['src/send/a.js', 'src/Send.js', 'src/Other.js', 'README.md', 'package.json'];
    expect(picksOfFiles(withFiles, files)).toEqual({
      picks: [{ type: 'feature', id: 'send-f' }],
      unlisted: ['src/Other.js', 'package.json'],
    });
  });

  it('keeps only the scenarios a pick reaches, and the union of several picks', () => {
    const scenarios = allScenarios(graph);
    const fee = affectedIds(graph, [pickOf(graph, 'token:fee')], scenarios);
    expect(fee.size).toBeGreaterThan(0);
    expect(fee.size).toBeLessThan(scenarios.length);
    scenarios.forEach((s) => expect(fee.has(s.id)).toBe(s.values.token === 'fee'));
    const both = affectedIds(graph, [pickOf(graph, 'token:fee'), pickOf(graph, 'send-f')], scenarios);
    fee.forEach((id) => expect(both.has(id)).toBe(true));
    expect(both.size).toBeGreaterThan(fee.size);
    expect(affectedIds(graph, [], scenarios).size).toBe(0);
  });
});
