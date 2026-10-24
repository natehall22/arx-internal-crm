#!/usr/bin/env bash
# Installs the pre-push gate hook ONCE for the whole repository: the checkout and every worktree, on any branch.
# It copies .githooks/pre-push into the shared hooks folder and points git at it (the hook reads per-commit stamps, so it does
# not matter which branch or worktree you push from). Re-run after the hook changes:  bash scripts/install-hooks.sh
set -eu
COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
HOOKS="$COMMON/hooks"
mkdir -p "$HOOKS"
cp "$(git rev-parse --show-toplevel)/.githooks/pre-push" "$HOOKS/pre-push"
chmod +x "$HOOKS/pre-push"
git config core.hooksPath "$HOOKS"
# A worktree may carry its own override (the desktop app sets one); make every worktree use the shared folder.
for wt in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
  if git -C "$wt" config --worktree --get core.hooksPath >/dev/null 2>&1; then git -C "$wt" config --worktree core.hooksPath "$HOOKS"; fi
done
echo "pre-push gate hook installed in $HOOKS"
