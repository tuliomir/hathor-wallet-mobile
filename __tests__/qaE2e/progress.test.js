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
  newProgress, apply, message, redact, longestGap, USUAL_GAP, STUCK_FACTOR,
} from '../../QA/e2e/lib/progress';

const row = (id, wallet, { seconds = 60, measured = true, state = 'new' } = {}) => ({
  scenario: { id: `send:pn-fn-seed-multi:${id}`, values: { 'private-balance': wallet } },
  outcome: { id: 'ok-sent', message: 'Sent' },
  standing: { state, why: state === 'new' ? ['never ran'] : ['its flow'] },
  seconds,
  measured,
});
const job = { id: 'fn/send', setup: 'pn-fn-seed-multi', action: 'send' };
const fresh = () => newProgress({ id: 'full-1', mode: 'full' }, [{
  job,
  rows: [row('a.unlocked', 'unlocked'), row('b.locked', 'locked', { measured: false }), row('c.unlocked', 'unlocked', { state: 'changed' })],
}], { setupSeconds: { unlocked: 160, locked: 230, 'broken-key': 220 } });
const at = (s) => new Date(Date.UTC(2026, 10, 26, 12, 0, s)).toISOString();

describe('a new run', () => {
  it('lists each job\'s scenarios by wallet, queued, with their tag and estimate', () => {
    const p = fresh();
    const [j] = p.jobs;
    expect(p.run.state).toBe('starting');
    expect(j.facade).toBe('fullnode');
    expect(j.groups.map((g) => [g.wallet, g.scenarios, g.setupEstimateSeconds])).toEqual([['unlocked', 2, 160], ['locked', 1, 230]]);
    expect(j.scenarios.map((s) => [s.title, s.status, s.tag, s.estimateFrom])).toEqual([
      ['a.unlocked', 'queued', 'new', 'last run'],
      ['c.unlocked', 'queued', 'changed', 'last run'],
      ['b.locked', 'queued', 'new', 'guess'],
    ]);
    expect(j.estimateSeconds).toBe(3 * 60 + 160 + 230);
    expect(j.estimateFrom).toBe('mixed');
  });
});

describe('events', () => {
  it('follow a job through setup, scenarios and its end', () => {
    const p = fresh();
    apply(p, { type: 'job-started', job: 'fn/send', at: at(0), tries: 1 });
    apply(p, { type: 'setup-started', job: 'fn/send', at: at(1), wallet: 'unlocked' });
    expect(p.current).toMatchObject({ job: 'fn/send', phase: 'setup', wallet: 'unlocked' });
    apply(p, { type: 'setup-finished', job: 'fn/send', at: at(2), wallet: 'unlocked' });
    const { id } = p.jobs[0].scenarios[0];
    apply(p, { type: 'scenario-started', job: 'fn/send', at: at(3), scenario: id });
    apply(p, { type: 'step', job: 'fn/send', at: at(4), text: '1/4 address' });
    expect(p.current).toMatchObject({ phase: 'scenario', scenario: id, step: { text: '1/4 address' } });
    // A step is not an event that says the run moves on.
    expect(p.current.lastEventAt).toBe(at(3));
    apply(p, { type: 'scenario-finished', job: 'fn/send', at: at(9), scenario: id, status: 'passed', note: 'reached: ok-sent' });
    expect(p.jobs[0].scenarios[0]).toMatchObject({ status: 'passed', started: at(3), finished: at(9) });
    apply(p, { type: 'job-finished', job: 'fn/send', at: at(10), counts: { passed: 1, failed: 0, skipped: 0 } });
    expect(p.jobs[0]).toMatchObject({ status: 'done', counts: { passed: 1 } });
    expect(p.events[0].text).toBe('fn/send: 1 passed, 0 failed, 0 skipped');
  });

  it('keep a broken setup apart from the scenarios it kept from running', () => {
    const p = fresh();
    apply(p, { type: 'job-started', job: 'fn/send', at: at(0) });
    apply(p, { type: 'setup-finished', job: 'fn/send', at: at(1), wallet: 'locked', error: 'funding did not land' });
    const locked = p.jobs[0].scenarios[2];
    apply(p, { type: 'scenario-not-run', job: 'fn/send', at: at(1), scenario: locked.id, status: 'did not run', note: 'setup failed' });
    expect(p.jobs[0].groups[1].setupError).toBe('funding did not land');
    expect(locked.status).toBe('did not run');
  });

  it('say a job that stopped did not finish, and fail the scenario it stopped in', () => {
    const p = fresh();
    apply(p, { type: 'job-started', job: 'fn/send', at: at(0) });
    apply(p, { type: 'scenario-started', job: 'fn/send', at: at(1), scenario: p.jobs[0].scenarios[0].id });
    apply(p, { type: 'job-finished', job: 'fn/send', at: at(2), counts: null });
    expect(p.jobs[0].status).toBe('did not finish');
    expect(p.jobs[0].scenarios[0].status).toBe('failed');
  });

  it('start a second try from scratch, and keep what the first said', () => {
    const p = fresh();
    const [first] = p.jobs[0].scenarios;
    apply(p, { type: 'job-started', job: 'fn/send', at: at(0), tries: 1 });
    apply(p, { type: 'scenario-finished', job: 'fn/send', at: at(1), scenario: first.id, status: 'failed', note: 'driver died' });
    apply(p, { type: 'job-started', job: 'fn/send', at: at(2), tries: 2 });
    expect(p.jobs[0].tries).toBe(2);
    expect(first).toMatchObject({ status: 'queued', firstTry: { status: 'failed', note: 'driver died' } });
  });

  it('pause between parts with the command to resume, and count each part\'s span', () => {
    const p = fresh();
    apply(p, { type: 'part-started', at: at(0), n: 1, minutes: 110 });
    apply(p, { type: 'part-ended', at: at(30), text: 'part 1 ended', resume: 'npm run e2e:full -- --resume' });
    expect(p.run).toMatchObject({ state: 'paused', resume: 'npm run e2e:full -- --resume' });
    apply(p, { type: 'part-started', at: at(50), n: 2, minutes: 110 });
    expect(p.run.state).toBe('running');
    expect(p.run.parts).toEqual([
      { n: 1, startedAt: at(0), endedAt: at(30) }, { n: 2, startedAt: at(50) },
    ]);
    apply(p, { type: 'run-finished', at: at(55), text: 'done' });
    expect(p.run.parts[1].endedAt).toBe(at(55));
    expect(p.run.resume).toBeUndefined();
  });

  it('tell the page what to run after a run that ended with failures', () => {
    const p = fresh();
    apply(p, { type: 'run-finished', text: 'some failed', resume: 'npm run e2e:full -- --resume --retry' });
    expect(p.run).toMatchObject({ state: 'finished', resume: 'npm run e2e:full -- --resume --retry' });
  });
});

describe('when a run counts as stuck', () => {
  it('is 3 times the longest gap between events, and never under 3 times a wallet\'s setup', () => {
    const p = fresh();
    apply(p, { type: 'job-started', job: 'fn/send', at: at(0) });
    expect(p.run.stuckAfterSeconds).toBe(STUCK_FACTOR * USUAL_GAP);
    const events = [{ at: '2026-11-26T12:20:00Z' }, { at: '2026-11-26T12:00:00Z' }, { at: '2026-11-26T11:59:00Z' }];
    expect(longestGap(events)).toBe(1200);
  });

  it('leaves out the pause between parts', () => {
    const events = [{ at: '2026-11-26T14:00:00Z', type: 'part-started' }, { at: '2026-11-26T12:00:00Z', type: 'part-ended' }];
    expect(longestGap(events)).toBe(0);
  });
});

describe('what the dashboard never shows', () => {
  it('shortens full addresses, in notes and messages too', () => {
    const address = 'WZ7pDnkPnxbs14GHa1i1Pt3HpbXJpqKUJZ4ZVJFMeSdX9BhmBkU6';
    expect(redact(`sent to ${address}.`)).toBe('sent to WZ7pDn…BkU6.');
    expect(message({ kind: 'note', text: `paid ${address}` }).text).toBe('paid WZ7pDn…BkU6');
    const p = fresh();
    apply(p, { type: 'job-started', job: 'fn/send', at: at(0) });
    apply(p, {
      type: 'scenario-finished', job: 'fn/send', at: at(1), scenario: p.jobs[0].scenarios[0].id, status: 'failed', note: `expected ${address}`,
    });
    expect(JSON.stringify(p)).not.toContain(address);
  });

  it('refuses a message of a kind it doesn\'t know', () => {
    expect(() => message({ kind: 'shout', text: 'x' })).toThrow(/why, a note, a finding or a correction/);
  });
});
