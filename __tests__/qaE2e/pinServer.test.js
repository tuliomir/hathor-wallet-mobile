/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { keysTapped, startPinServer } from '../../QA/e2e/lib/pinServer';

const tapLine = (digit, bounds) => (
  `20:39:55.882 [ INFO] maestro.Maestro.tap: Tapping on element:  UiElement(treeNode=TreeNode(attributes={text=, resource-id=numpad-key-${digit}, clickable=true, bounds=${bounds}, enabled=true`);

/** Stands in for adb: appends what it is asked to run to a file, or fails. */
function fakeAdb(status = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
  const file = path.join(dir, 'adb');
  const calls = path.join(dir, 'calls');
  fs.writeFileSync(file, `#!/bin/sh\necho "$@" >> ${calls}\nexit ${status}\n`, { mode: 0o755 });
  return { file, calls: () => fs.readFileSync(calls, 'utf8').trim() };
}

describe('pin server', () => {
  it('reads where the keys were tapped from a Maestro log', () => {
    const log = [tapLine(1, '[49,1591][374,1738]'), 'other', tapLine(4, '[49,1749][374,1896]')].join('\n');
    expect(keysTapped(log)).toEqual({ 1: ['212', '1665'], 4: ['212', '1823'] });
    expect(keysTapped('Tap on id: numpad-key-3 COMPLETED')).toEqual({});
  });

  it('taps the digits after the first, with a pause between them', async () => {
    const adb = fakeAdb();
    const server = await startPinServer(adb.file, '123', () => ({ 2: ['20', '2'], 3: ['30', '3'] }));
    const response = await fetch(server.url, { method: 'POST' });
    server.close();
    expect(response.ok).toBe(true);
    expect(adb.calls()).toBe('shell input tap 20 2; sleep 0.3; input tap 30 3');
  });

  it('answers with an error when adb fails, so that the flow fails', async () => {
    const server = await startPinServer(fakeAdb(1).file, '12', () => ({ 2: ['20', '2'] }));
    const response = await fetch(server.url, { method: 'POST' });
    server.close();
    expect(response.status).toBe(500);
  });
});
