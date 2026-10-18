#!/usr/bin/env bash
# Tags the version main is at, once the Version PR is merged and no changesets are pending.
# The Version workflow runs it after changesets/action. Pushing the tag starts the Release workflow.

set -euo pipefail

cd "$(dirname "$0")/.."

# Read main itself, not the working tree, which another step may have switched.
git fetch --quiet origin main
ref=origin/main

pending=$(git ls-tree --name-only "$ref" .changeset/ | grep '\.md$' | grep -vc 'README.md$' || true)
if [ "$pending" != "0" ]; then
  echo "$pending changeset(s) pending: nothing to tag."
  exit 0
fi

version=$(git show "$ref:apps/cli/package.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")
tag="v$version"

if [ "$version" = "0.0.0" ]; then
  echo "Version is 0.0.0: nothing released yet."
  exit 0
fi

if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  echo "$tag already exists."
  exit 0
fi

git tag "$tag" "$ref"
git push origin "$tag"
echo "Tagged $tag."
