/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Records the emulator's screen with Android's own screenrecord: the device encodes, nothing is
// rendered afterwards, so a recording is ready the moment the run stops it.

const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const DEVICE_FILE = '/data/local/tmp/e2e-recording.mp4';

/**
 * Starts recording; resolves once the first frame is being taken, with `t0`, that moment in
 * host milliseconds, and `stop(file)`, which ends the recording, pulls it to `file` and resolves
 * with the host time it stopped at.
 *
 * screenrecord prints "Configuring recorder" as it starts its encoder; measured against the
 * device-time overlay of --bugreport, the video's first frame is within a frame (about 0.1 s) of
 * that line. Timing against the host clock sidesteps the emulator's clock, which runs behind it.
 *
 * Call it outside of a blocking (spawnSync) call: the line is timed when Node reads it.
 */
function startRecording(adb) {
  execFileSync(adb, ['shell', 'rm', '-f', DEVICE_FILE]);
  // --time-limit 0: no limit (Android 14 and later; older ones stop at 3 minutes).
  const proc = spawn(adb, ['shell', 'screenrecord', '--verbose', '--time-limit', '0', '--bit-rate', '8000000', DEVICE_FILE]);
  const exited = new Promise((resolve) => { proc.on('exit', resolve); });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('screenrecord did not start')), 15000);
    let output = '';
    proc.stdout.on('data', (data) => {
      output += data;
      if (!output.includes('Configuring recorder')) return;
      const t0 = Date.now();
      clearTimeout(timer);
      proc.stdout.removeAllListeners('data');
      resolve({
        t0,
        async stop(file) {
          const stoppedAt = Date.now();
          // SIGINT makes screenrecord finish the mp4; a killed one leaves it unreadable.
          execFileSync(adb, ['shell', 'pkill', '-INT', 'screenrecord']);
          await exited;
          execFileSync(adb, ['pull', '-q', DEVICE_FILE, file]);
          execFileSync(adb, ['shell', 'rm', '-f', DEVICE_FILE]);
          return stoppedAt;
        },
      });
    });
    proc.on('exit', () => reject(new Error(`screenrecord exited: ${output.trim().split('\n').pop()}`)));
  });
}

/** ffmpeg's filter that blacks out the whole frame over these [from, to] seconds. */
function blackoutFilter(ranges) {
  const when = ranges.map(([from, to]) => `between(t,${from.toFixed(2)},${to.toFixed(2)})`).join('+');
  return `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='${when}'`;
}

/**
 * Blacks out a recording over these ranges, in place: for a screen that shows a secret. When
 * ffmpeg fails the recording is deleted, never kept with the secret in it.
 */
function blackout(file, ranges) {
  if (!ranges.length) return;
  const out = file.replace(/\.mp4$/, '.blackout.mp4');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', blackoutFilter(ranges), '-an', out]);
    fs.renameSync(out, file);
  } catch (e) {
    fs.rmSync(file, { force: true });
    fs.rmSync(out, { force: true });
    throw new Error(`could not black out the recording, so it was deleted: ${e.message.split('\n')[0]}`);
  }
}

module.exports = { startRecording, blackout, blackoutFilter };
