/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  afterAll, beforeAll, describe, expect, it,
} from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  treeIndex, workIndex, checkoutIds, appId,
} from '../../QA/e2e/lib/fingerprint';

const graph = { features: [{ id: 'send', files: ['src/send/', 'src/Send.js'] }, { id: 'none' }] };
const actions = { history: ['QA/e2e/lib/historyScenarios.js'] };
let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};
const ids = (index = workIndex(repo)) => checkoutIds(index, graph, actions);

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fingerprint-'));
  git('init', '-q');
  write('src/send/a.js', 'a');
  write('src/Other.js', 'o');
  write('package.json', '{"scripts":{"a":"b"},"dependencies":{"x":"1.0.0"}}');
  write('QA/e2e/run.js', 'run');
  write('QA/e2e/README.md', 'docs');
  write('QA/e2e/lib/sendFlow.js', 'flow');
  write('QA/e2e/lib/historyScenarios.js', 'history');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'x');
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

/** What differs after a change to a file, which is then undone. */
function changedBy(file, text) {
  const before = ids();
  const was = fs.existsSync(path.join(repo, file)) ? fs.readFileSync(path.join(repo, file), 'utf8') : null;
  write(file, text);
  const after = ids();
  if (was === null) fs.rmSync(path.join(repo, file));
  else write(file, was);
  expect(ids()).toEqual(before);
  return ['app', 'kit'].filter((key) => before[key] !== after[key])
    .concat(Object.keys(before.features).filter((id) => before.features[id] !== after.features[id]))
    .concat(Object.keys(before.actions).filter((id) => before.actions[id] !== after.actions[id]));
}

describe('what a checkout is', () => {
  it('is the same for a commit and its clean tree', () => {
    expect(workIndex(repo)).toEqual(treeIndex(repo, 'HEAD'));
  });

  it('tells a feature\'s files, the app\'s others, an action\'s checks and the shared kit apart', () => {
    expect(changedBy('src/send/a.js', 'b')).toEqual(['send']);
    expect(changedBy('src/send/new.js', 'untracked')).toEqual(['send']);
    expect(changedBy('src/Other.js', 'b')).toEqual(['app']);
    expect(changedBy('QA/e2e/run.js', 'b')).toEqual(['kit']);
    expect(changedBy('QA/e2e/lib/historyScenarios.js', 'b')).toEqual(['history']);
  });

  it('ignores the docs, the flow builders and the npm scripts, and not the dependencies', () => {
    expect(changedBy('QA/e2e/README.md', 'b')).toEqual([]);
    expect(changedBy('QA/e2e/lib/sendFlow.js', 'b')).toEqual([]);
    expect(changedBy('package.json', '{"scripts":{"c":"d"},"dependencies":{"x":"1.0.0"}}')).toEqual([]);
    expect(changedBy('package.json', '{"scripts":{"a":"b"},"dependencies":{"x":"1.0.1"}}')).toEqual(['app']);
  });

  it('sees a deleted file', () => {
    const before = ids();
    fs.rmSync(path.join(repo, 'src/send/a.js'));
    expect(ids().features.send).not.toBe(before.features.send);
    write('src/send/a.js', 'a');
  });

  it('builds the app again for its sources only', () => {
    const before = appId(workIndex(repo));
    write('QA/e2e/run.js', 'changed');
    expect(appId(workIndex(repo))).toBe(before);
    write('src/send/a.js', 'changed');
    expect(appId(workIndex(repo))).not.toBe(before);
  });
});
