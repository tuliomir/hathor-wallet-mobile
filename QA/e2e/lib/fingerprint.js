/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// What a checkout's files are, as git blob ids, so that a scenario's last pass can be compared with
// the code at hand whatever the branch or the merge it came from.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { matchesEntry } = require('../../graph/tools/freshness');

const asList = (value) => (Array.isArray(value) ? value : []);
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// What the app is built from. The kit's npm scripts are in package.json too, so only its
// dependencies count.
const APP = /^(src\/|locale\/|patches\/|android\/|package(-lock)?\.json$|(index|shim|i18nInit|babel\.config|metro\.config)\.js$|app\.json$)/;
// Of the kit, what doesn't change how a scenario runs: the docs, the viewer, the live dashboard
// and its design, and the suite's own selection; and the builders of flows, as each scenario's
// flow is compared by itself.
const NOT_KIT = new RegExp('^QA/e2e/(.*\\.md$|viewer/|dashboard/|design/|evidence/|ledger\\.json$|suite\\.js$'
  + '|bin/(serve-viewer|try-branch)'
  + '|lib/(jobs|fingerprint|ledger|select|smoke|app|timeline|affected|sendFlow|createTokenFlow'
  + '|progress|live)\\.js$)');

/** A package.json's id in an index: its dependencies only. */
function packageId(text) {
  const { dependencies, devDependencies, overrides } = JSON.parse(text);
  return sha1(JSON.stringify({ dependencies, devDependencies, overrides }));
}

const git = (repo, args, input) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024,
});

/** Every file of a commit, as { path: blob id }. */
function treeIndex(repo, ref) {
  const index = {};
  git(repo, ['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean).forEach((line) => {
    const [meta, file] = line.split('\t');
    [, , index[file]] = meta.split(' ');
  });
  if (index['package.json']) index['package.json'] = packageId(git(repo, ['show', `${ref}:package.json`]));
  return index;
}

/** Every file of the working tree as it stands, uncommitted and untracked ones included. */
function workIndex(repo) {
  const index = {};
  git(repo, ['ls-files', '-s', '-z']).split('\0').filter(Boolean).forEach((line) => {
    const [meta, file] = line.split('\t');
    [, index[file]] = meta.split(' ');
  });
  const list = (args) => git(repo, args).split('\0').filter(Boolean);
  const changed = [
    ...list(['diff', '--name-only', '-z', 'HEAD']),
    ...list(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  const there = changed.filter((file) => fs.existsSync(path.join(repo, file))
    && fs.statSync(path.join(repo, file)).isFile());
  changed.forEach((file) => { delete index[file]; });
  if (there.length) {
    const ids = git(repo, ['hash-object', '--stdin-paths'], there.join('\n')).trim().split('\n');
    there.forEach((file, i) => { index[file] = ids[i]; });
  }
  if (index['package.json']) index['package.json'] = packageId(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  return index;
}

/** One id for the files a test picks; the same for the same files with the same contents. */
function idOf(index, wanted) {
  const files = Object.keys(index).filter(wanted).sort();
  return files.length ? sha1(files.map((file) => `${file} ${index[file]}`).join('\n')).slice(0, 12) : null;
}

/** The ids of everything that isn't a scenario's own: each feature's files, and the rest. */
function checkoutIds(index, graph, actionFiles) {
  const listed = asList(graph.features).flatMap((feature) => asList(feature.files));
  const own = new Set(Object.values(actionFiles).flat());
  return {
    features: Object.fromEntries(asList(graph.features)
      .filter((feature) => asList(feature.files).length)
      .map((feature) => [feature.id, idOf(index, (file) => (
        feature.files.some((entry) => matchesEntry(entry, file))))])),
    // The app's files no feature lists: nothing tells which scenarios they reach.
    app: idOf(index, (file) => (
      APP.test(file) && !listed.some((entry) => matchesEntry(entry, file)))),
    kit: idOf(index, (file) => file.startsWith('QA/e2e/') && !NOT_KIT.test(file) && !own.has(file)),
    actions: Object.fromEntries(Object.entries(actionFiles)
      .map(([action, files]) => [action, idOf(index, (file) => files.includes(file))])),
  };
}

/** The id of everything the app is built from. */
const appId = (index) => idOf(index, (file) => APP.test(file));

module.exports = { treeIndex, workIndex, checkoutIds, appId, packageId };
