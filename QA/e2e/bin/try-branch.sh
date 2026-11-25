#!/bin/bash
# Copyright (c) Hathor Labs and its affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

# Runs the `dev` suite for a branch that doesn't have this kit: merges the branch with the kit's
# checkout (its committed HEAD) in a worktree of its own, next to it, and runs there the scenarios
# that what the branch changes reaches.
#
#   try-branch.sh [<ref>] [-- <options of suite.js dev>]
#
# Without a ref: what is checked out where you call it from, uncommitted changes to tracked files
# included. The worktree, mobile-wallet-e2e-<slug>, is kept for the next time, which is faster;
# `git worktree remove` it when the branch is done. It needs Node 22.
set -euo pipefail
KIT=$(cd "$(dirname "$0")/../../.." && pwd)
REF=
if [ $# -gt 0 ] && [ "$1" != -- ]; then REF=$1; shift; fi
if [ "${1:-}" = -- ]; then shift; fi

if [ -n "$REF" ]; then
  NAME=$REF
  COMMIT=$(git -C "$KIT" rev-parse --verify --quiet "$REF^{commit}") || { echo "try-branch: no commit $REF" >&2; exit 1; }
else
  [ "$(git rev-parse --path-format=absolute --git-common-dir)" = "$(git -C "$KIT" rev-parse --path-format=absolute --git-common-dir)" ] \
    || { echo "try-branch: call it from a checkout of the same repository, or give a ref" >&2; exit 1; }
  NAME=$(git rev-parse --abbrev-ref HEAD)
  [ "$NAME" != HEAD ] || NAME=$(basename "$PWD")
  UNTRACKED=$(git ls-files --others --exclude-standard -- src patches)
  [ -z "$UNTRACKED" ] || { printf 'try-branch: untracked files would be left out; git add them:\n%s\n' "$UNTRACKED" >&2; exit 1; }
  COMMIT=$(git stash create)
  COMMIT=${COMMIT:-$(git rev-parse HEAD)}
fi
[ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || { echo "try-branch: needs Node 22 (README \"Preparing a checkout\")" >&2; exit 1; }

BASE=$(git -C "$KIT" rev-parse HEAD)
TREE=$(dirname "$KIT")/mobile-wallet-e2e-$(echo "$NAME" | tr -c 'A-Za-z0-9\n' - | sed 's/^-*//; s/-*$//')
if [ ! -d "$TREE" ]; then
  git -C "$KIT" worktree add --quiet --detach "$TREE" "$BASE"
else
  [ -z "$(git -C "$TREE" status --porcelain --untracked-files=no)" ] || { echo "try-branch: $TREE has changes; commit them on your branch or discard them" >&2; exit 1; }
  git -C "$TREE" checkout --quiet --detach "$BASE"
fi
cd "$TREE"
if ! git -c commit.gpgsign=false merge --quiet --no-edit "$COMMIT"; then
  CONFLICTS=$(git diff --name-only --diff-filter=U)
  git merge --abort
  printf 'try-branch: %s conflicts with the kit in:\n%s\nMerge the kit into a copy of your branch by hand, and run npm run e2e:dev there.\n' "$NAME" "$CONFLICTS" >&2
  exit 1
fi

# Dependencies and generated files, when what they come from changed.
PREPARED=$(git rev-parse --git-dir)/e2e-prepared
WANTED=$(cat package-lock.json patches/* QA/e2e/tools/package-lock.json locale/*/texts.po 2>/dev/null | sha1sum)
if [ "$(cat "$PREPARED" 2>/dev/null)" != "$WANTED" ] || [ ! -d node_modules ]; then
  echo "try-branch: preparing $TREE (a few minutes)"
  cp "$KIT/android/app/google-services.json" android/app/
  npm ci >/dev/null
  ./node_modules/.bin/allow-scripts >/dev/null
  npx rn-nodeify --install stream,process,path,events,crypto,console,buffer,zlib --hack >/dev/null
  npx patch-package >/dev/null
  for l in da pt-br ru-ru; do mkdir -p "src/locale/$l"; npx ttag po2json "locale/$l/texts.po" > "src/locale/$l/texts.po.json"; done
  (cd QA/e2e/tools && npm ci >/dev/null)
  # What the preparation rewrites of the checkout (rn-nodeify edits package.json) is not the branch's.
  git checkout --quiet -- .
  echo "$WANTED" > "$PREPARED"
fi
echo "try-branch: $NAME with the kit, in $TREE"
exec node QA/e2e/suite.js dev --since "$BASE" "$@"
