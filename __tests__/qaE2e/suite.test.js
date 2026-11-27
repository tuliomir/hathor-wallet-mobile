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
import {
  JOBS, jobsOf, keyOf, ranAll,
} from '../../QA/e2e/lib/jobs';
import { planScenarios } from '../../QA/e2e/lib/plan';
import { ACTIONS, flowOf, digest } from '../../QA/e2e/lib/flows';
import { merged } from '../../QA/e2e/lib/ledger';
import { smokeOf } from '../../QA/e2e/lib/smoke';
import {
  reachOf, currentOf, standing, forDev,
} from '../../QA/e2e/lib/select';

const graph = loadGraph(path.join(__dirname, '..', '..', 'QA', 'graph', 'graph.yaml'));
const reach = { direct: ['send'], indirect: ['pin'] };
const passed = {
  status: 'passed', flow: 'f', outcome: 'o', checks: 'c', features: { send: '1', pin: '1' }, app: 'a', kit: 'k',
};
const now = { ...passed, status: undefined };

describe('where a scenario stands', () => {
  const state = (entry, current = now, options) => standing(entry, current, reach, options).state;

  it('is fresh only when nothing of what it passed with changed', () => {
    expect(state(passed)).toBe('fresh');
    expect(state(undefined)).toBe('new');
    expect(state({ ...passed, status: 'failed' })).toBe('failed');
    expect(state({ ...passed, status: 'stale app' })).toBe('failed');
  });

  it('is changed by its own test and its own features, and says which', () => {
    ['flow', 'outcome', 'checks'].forEach((field) => {
      const result = standing(passed, { ...now, [field]: 'new' }, reach);
      expect(result).toMatchObject({ state: 'changed', own: true });
      expect(result.why).toHaveLength(1);
    });
    expect(standing(passed, { ...now, features: { send: '2', pin: '1' } }, reach))
      .toEqual({ state: 'changed', why: ['feature send'], own: false });
  });

  it('is owed, never fresh, for shared code: other features, unlisted app files, the kit', () => {
    expect(state(passed, { ...now, features: { send: '1', pin: '2' } })).toBe('owed');
    expect(state(passed, { ...now, app: 'b' })).toBe('owed');
    expect(state(passed, { ...now, kit: 'b' })).toBe('owed');
  });

  it('of a ref without the kit, compares the app only', () => {
    const then = { ...passed, flow: 'x', checks: null, kit: null };
    expect(state(then, now, { lacksKit: true })).toBe('fresh');
    expect(state(then, { ...now, app: 'b' }, { lacksKit: true })).toBe('owed');
  });
});

describe('what dev runs', () => {
  const fn = { id: 'fn/x', primary: true };
  const ws = { id: 'ws/x', primary: false };
  const row = (job, name, s) => ({ job, name, standing: s });
  const owed = { state: 'owed', why: [] };
  const byFeature = { state: 'changed', why: [], own: false };
  const own = { state: 'changed', why: [], own: true };
  const fresh = { state: 'fresh', why: [] };
  const names = ({ run, owed: left }) => [run.map((r) => r.name), left.map((r) => r.name)];
  const one = (rows) => rows.slice(0, 1);

  it('runs a feature\'s change in full on the fullnode, and a sample elsewhere', () => {
    const rows = [row(fn, 'a', byFeature), row(fn, 'b', byFeature), row(ws, 'c', byFeature), row(ws, 'd', byFeature)];
    expect(names(forDev(rows, one))).toEqual([['a', 'b', 'c'], ['d']]);
    expect(names(forDev(rows, one, { all: true }))).toEqual([['a', 'b', 'c', 'd'], []]);
    expect(names(forDev(rows, one, { quick: true }))).toEqual([['a', 'c'], ['b', 'd']]);
  });

  it('always runs what is new, failed or changed itself', () => {
    const rows = [row(ws, 'a', { state: 'new', why: [] }), row(ws, 'b', { state: 'failed', why: [] }), row(ws, 'c', own), row(ws, 'd', owed)];
    expect(names(forDev(rows, one))).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('samples a job that only owes, and leaves nothing unaccounted for', () => {
    const rows = [row(fn, 'a', owed), row(fn, 'b', owed), row(fn, 'c', fresh)];
    expect(names(forDev(rows, one))).toEqual([['a'], ['b']]);
    expect(names(forDev([row(fn, 'c', fresh)], one))).toEqual([[], []]);
  });

  it('neither runs nor owes what the kit can\'t run yet', () => {
    const skipped = { state: 'skipped', why: ['needs a camera helper'] };
    expect(names(forDev([row(fn, 'a', skipped), row(fn, 'b', fresh)], one))).toEqual([[], []]);
    expect(names(forDev([row(fn, 'a', skipped), row(fn, 'b', owed)], one, { quick: true }))).toEqual([['b'], []]);
  });
});

describe('the suite', () => {
  const all = JOBS.map((job) => ({ job, plan: planScenarios(graph, job) }));

  it('has every action the kit runs, on both facades, with scenarios in each', () => {
    all.forEach(({ plan }) => expect(plan.length).toBeGreaterThan(0));
    ['fn', 'ws'].forEach((facade) => ACTIONS.forEach((action) => {
      expect(JOBS.some((job) => job.id.startsWith(facade) && job.action === action)).toBe(true);
    }));
  });

  it('names its scenarios apart, created tokens included', () => {
    const keys = all.flatMap(({ job, plan }) => (
      plan.map((p) => keyOf(p.scenario, job.createdTokens))));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('finds jobs by id, facade or name, and refuses a name that is none', () => {
    expect(jobsOf('fn/history').map(({ id }) => id)).toEqual(['fn/history']);
    expect(jobsOf('history').map(({ id }) => id)).toEqual(['fn/history', 'ws/history']);
    expect(jobsOf('ws')).toHaveLength(JOBS.length / 2);
    expect(() => jobsOf('histroy')).toThrow('histroy');
  });

  it('has a smoke sample of every job', () => {
    all.forEach(({ plan }) => {
      const sample = smokeOf(plan);
      expect(sample.length).toBeGreaterThan(0);
      sample.forEach((p) => expect(plan).toContain(p));
    });
  });

  it('digests a scenario\'s flow the same every time, whatever else runs with it', () => {
    const [{ plan }] = all.filter(({ job }) => job.id === 'fn/send');
    const digests = plan.map((p) => digest(flowOf(p.scenario, p.outcome)));
    expect(digests).toEqual(plan.map((p) => digest(flowOf(p.scenario, p.outcome))));
    expect(new Set(digests).size).toBe(plan.length);
  });

  it('reaches each scenario directly from the feature of its action', () => {
    const scenarios = all.flatMap(({ plan }) => plan.map((p) => p.scenario));
    const found = reachOf(graph, scenarios);
    const featureOf = Object.fromEntries(graph.actions.map((a) => [a.id, a.feature]));
    scenarios.forEach((s) => expect(found[s.id].direct).toContain(featureOf[s.action]));
    const p = all[0].plan[0];
    const ids = { features: {}, actions: {}, app: 'a', kit: 'k' };
    expect(currentOf({ ...p, flow: 'f' }, ids, found)).toMatchObject({ flow: 'f', outcome: p.outcome.id });
  });
});

describe('the ledger', () => {
  it('takes the newest entry of the two', () => {
    const committed = { a: { at: '2', status: 'passed' }, b: { at: '2' } };
    const local = { a: { at: '1', status: 'failed' }, b: { at: '3' }, c: { at: '1' } };
    expect(merged(committed, local)).toEqual({ a: committed.a, b: local.b, c: local.c });
  });
});

describe('a job that ran all it planned', () => {
  it('counts a skip as no failure, so that full --retry leaves the job be', () => {
    expect(ranAll({ passed: 2, failed: 0, skipped: 2 }, 4)).toBe(true);
    expect(ranAll({ passed: 25, failed: 0, skipped: 0 }, 25)).toBe(true);
  });

  it('is not one with a failure, or one that did not finish', () => {
    expect(ranAll({ passed: 20, failed: 5, skipped: 0 }, 25)).toBe(false);
    expect(ranAll({ passed: 1, failed: 1, skipped: 2 }, 4)).toBe(false);
    expect(ranAll(null, 4)).toBe(false);
  });
});
