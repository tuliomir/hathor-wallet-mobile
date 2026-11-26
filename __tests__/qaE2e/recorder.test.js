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
import { blackout, blackoutFilter } from '../../QA/e2e/lib/recorder';

describe('blacking out a recording', () => {
  it('fills the whole frame over each range', () => {
    expect(blackoutFilter([[1, 2.5], [10.25, 12]]))
      .toBe("drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,1.00,2.50)+between(t,10.25,12.00)'");
  });

  it('deletes a recording it could not black out, rather than keep the secret', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-recorder-'));
    const file = path.join(dir, 'screen.mp4');
    fs.writeFileSync(file, 'not a video');
    expect(() => blackout(file, [[0, 1]])).toThrow('deleted');
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });

  it('leaves a recording with nothing to hide as it is', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-recorder-'));
    const file = path.join(dir, 'screen.mp4');
    fs.writeFileSync(file, 'kept');
    blackout(file, []);
    expect(fs.readFileSync(file, 'utf8')).toBe('kept');
    fs.rmSync(dir, { recursive: true });
  });
});
