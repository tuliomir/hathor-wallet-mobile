/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const { computeImpact } = require('../../graph/tools/impact');
const { matchesEntry } = require('../../graph/tools/freshness');

const asList = (value) => (Array.isArray(value) ? value : []);

/** A pick of the graph's impact tool, from its name: a feature, a flag, or an `axis:value`. */
function pickOf(graph, name) {
  if (name.includes(':')) return { type: 'axisValue', id: name };
  if (asList(graph.features).some(({ id }) => id === name)) return { type: 'feature', id: name };
  const flag = asList(graph.flags).find((f) => f.id === name || f.name === name);
  if (flag) return { type: 'flag', id: flag.id };
  throw new Error(`the graph has no feature or flag '${name}' (an axis value is <axis>:<value>)`);
}

/**
 * The features whose files changed, and the app's changed files that no feature lists: the graph
 * can't tell what those reach.
 */
function picksOfFiles(graph, files) {
  const features = asList(graph.features);
  const listedBy = (file) => features.filter((feature) => (
    asList(feature.files).some((entry) => matchesEntry(entry, file))));
  const ids = new Set(files.flatMap(listedBy).map(({ id }) => id));
  return {
    picks: features.filter(({ id }) => ids.has(id)).map(({ id }) => ({ type: 'feature', id })),
    unlisted: files.filter((file) => /^(src\/|android\/|patches\/|package(-lock)?\.json$)/.test(file)
      && !listedBy(file).length),
  };
}

/** The ids of the scenarios any of the picks reaches. */
function affectedIds(graph, picks, scenarios) {
  return new Set(picks.flatMap((pick) => (
    computeImpact(graph, pick, scenarios).scenarios.map(({ id }) => id))));
}

module.exports = { pickOf, picksOfFiles, affectedIds };
