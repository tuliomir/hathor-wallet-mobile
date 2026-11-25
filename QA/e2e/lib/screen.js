/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The app's screen, read and tapped with adb. For scenarios that read more than they type: a dump
// takes 1 to 2 s, where Maestro takes 8 s to start and 1 to 3 s a tap. It can't be used where the
// app never goes idle, as on its lock screen: uiautomator doesn't answer there.

const { execFileSync } = require('child_process');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
};
const unescape = (text) => text.replace(/&(?:#(\d+)|(\w+));/g, (all, code, name) => (
  code ? String.fromCodePoint(Number(code)) : ENTITIES[name] || all));

/** The nodes of a uiautomator dump: { id, text, x, y, height }, x and y being the centre. */
function nodesOf(xml) {
  return [...xml.matchAll(/<node [^>]*>/g)].map(([node]) => {
    const attribute = (name) => unescape((new RegExp(` ${name}="([^"]*)"`).exec(node) || [])[1] || '');
    const [x1, y1, x2, y2] = (attribute('bounds').match(/-?\d+/g) || [0, 0, 0, 0]).map(Number);
    return {
      id: attribute('resource-id'),
      text: attribute('text'),
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      height: y2 - y1,
    };
  });
}

const byId = (id) => (nodes) => nodes.find((node) => node.id === id);
const byText = (text) => (nodes) => nodes.find((node) => (
  text instanceof RegExp ? text.test(node.text) : node.text === text));
const describe = (target) => (target.id ? `the element ${target.id}` : `the text ${target.text}`);
const finder = (target) => (target.id ? byId(target.id) : byText(target.text));

/** What a dump lacks of what `shows` wants, in words. */
function mismatches(nodes, reads, { texts = [], noIds = [], noTexts = [] } = {}) {
  return [
    ...Object.entries(reads).map(([id, text]) => {
      const node = byId(id)(nodes);
      if (node && node.text === text) return null;
      return `${id} reads ${node ? `"${node.text}"` : 'nothing (it is not on screen)'}, not "${text}"`;
    }),
    ...texts.map((text) => (byText(text)(nodes) ? null : `the text ${text} does not show`)),
    ...noIds.map((id) => (byId(id)(nodes) ? `${id} shows` : null)),
    ...noTexts.map((text) => (byText(text)(nodes) ? `the text ${text} shows` : null)),
  ].filter(Boolean);
}

/** A driver of the emulator's screen. Targets are { id } or { text: string or RegExp }. */
function screenOf(adb) {
  const run = (...args) => execFileSync(adb, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const nodes = () => {
    try {
      return nodesOf(run('exec-out', 'uiautomator', 'dump', '/dev/tty'));
    } catch (e) {
      return []; // not idle yet
    }
  };
  const screen = {
    nodes,
    back: () => run('shell', 'input', 'keyevent', '4'),
    /** Waits until `check` of the nodes is true, or fails with what it was waiting for. */
    async until(what, check, seconds = 30) {
      const end = Date.now() + seconds * 1000;
      let found;
      do {
        found = check(nodes());
        if (found) return found;
        // eslint-disable-next-line no-await-in-loop
        await sleep(400);
      } while (Date.now() < end);
      throw new Error(`waited ${seconds} s for ${what}`);
    },
    wait: (target, seconds) => screen.until(describe(target), finder(target), seconds),
    /**
     * Waits until one dump has everything wanted: elements that read exactly a text, texts shown,
     * and ids and texts that don't show. One dump for many checks is what makes this fast. The
     * failure says what was wrong in the last one. Gives that dump's nodes.
     * @param {Object<string, string>} reads text by id
     * @param {{ texts?: Array, noIds?: string[], noTexts?: Array, seconds?: number }} [more]
     */
    async shows(reads, more = {}) {
      const { seconds = 30 } = more;
      let wrong = [];
      let all;
      try {
        return await screen.until('the screen', (found) => {
          all = found;
          wrong = mismatches(found, reads, more);
          return !wrong.length && found;
        }, seconds);
      } catch (e) {
        throw new Error(`after ${seconds} s: ${wrong.join('; ')}${all.length ? '' : ' (no dump of the screen)'}`);
      }
    },
    /** Taps a target of a dump already at hand. */
    tapIn(dump, target) {
      const node = finder(target)(dump);
      if (!node) throw new Error(`${describe(target)} is not on screen`);
      run('shell', 'input', 'tap', String(node.x), String(node.y));
    },
    async tap(target, seconds) {
      const node = await screen.wait(target, seconds);
      run('shell', 'input', 'tap', String(node.x), String(node.y));
    },
    /** Waits for a target, scrolling its list down when it isn't on screen; then gives it. */
    async scrollTo(target) {
      for (let i = 0; i < 5; i += 1) {
        const node = finder(target)(nodes());
        if (node && node.height > 40) return node;
        run('shell', 'input', 'swipe', '540', '1700', '540', '1100', '400');
        // eslint-disable-next-line no-await-in-loop
        await sleep(800);
      }
      throw new Error(`${describe(target)} is not in the list`);
    },
    /** Back to the dashboard from wherever the app is: a back on the dashboard would leave it. */
    async home() {
      for (let i = 0; i < 14; i += 1) {
        const all = nodes();
        if (byText('Nano Contracts')(all)) return;
        if (all.length) screen.back();
        // eslint-disable-next-line no-await-in-loop
        await sleep(700);
      }
      throw new Error('could not return to the dashboard');
    },
    input: (...args) => run('shell', 'input', ...args),
    screenshot: () => execFileSync(adb, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }),
  };
  return screen;
}

module.exports = { nodesOf, mismatches, screenOf };
