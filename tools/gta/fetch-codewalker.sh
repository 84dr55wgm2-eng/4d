#!/usr/bin/env bash
# Fetch CodeWalker at the pinned revision used by cw-extract (MIT, dexyfex). Not committed: vendor/ is gitignored.
set -euo pipefail
REV=485d56bec00262ed7fa472261cce7bbc6202b96e
DIR="$(cd "$(dirname "$0")" && pwd)/vendor/CodeWalker"
if [ -d "$DIR/.git" ] && [ "$(git -C "$DIR" rev-parse HEAD)" = "$REV" ]; then echo "CodeWalker $REV present"; exit 0; fi
rm -rf "$DIR"; mkdir -p "$DIR"
git -C "$DIR" init -q
git -C "$DIR" remote add origin https://github.com/dexyfex/CodeWalker
git -C "$DIR" fetch -q --depth 1 origin "$REV"
git -C "$DIR" checkout -q FETCH_HEAD
echo "CodeWalker $REV fetched into $DIR"
