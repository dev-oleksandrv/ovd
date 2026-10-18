#!/usr/bin/env bash
# Tags the version main is at, once the Version PR is merged and no changesets are pending.
# The Version workflow runs it after changesets/action. Pushing the tag starts the Release workflow.

set -euo pipefail

cd "$(dirname "$0")/.."

pending=$(find .changeset -name '*.md' ! -name 'README.md' | wc -l | tr -d ' ')
if [ "$pending" != "0" ]; then
  echo "$pending changeset(s) pending: nothing to tag."
  exit 0
fi

version=$(node -p "require('./apps/cli/package.json').version")
tag="v$version"

if [ "$version" = "0.0.0" ]; then
  echo "Version is 0.0.0: nothing released yet."
  exit 0
fi

if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  echo "$tag already exists."
  exit 0
fi

git tag "$tag"
git push origin "$tag"
echo "Tagged $tag."
