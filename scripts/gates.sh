#!/usr/bin/env bash
# Runs every gate on the EXACT commit you are about to push, and records that it passed.
#   jest -> tsc -> lint -> next build -> phone suite (Playwright)
# A gate that fails is run once more. If the rerun passes it is reported as FLAKY (so it gets fixed) and the gate counts as passed;
# if the rerun fails too, nothing is stamped and the push hook refuses. The working tree must be clean: the stamp is for HEAD, not for
# "HEAD plus whatever is on disk". Run with: npm run gates
set -u
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "gates: the working tree is not clean. Commit or stash first - the gates must run on the exact commit you push." >&2
  git status --short >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
STAMP_DIR="$(git rev-parse --git-common-dir)/arx-gates-passed"
mkdir -p "$STAMP_DIR"
STAMP="$STAMP_DIR/$SHA"
rm -f "$STAMP"
FLAKY=()

run_gate() {
  local name="$1"; shift
  echo ""
  echo "=== gate: $name ==="
  if "$@"; then echo "--- $name: pass"; return 0; fi
  echo "--- $name FAILED - running it once more to tell a flake from a real failure"
  if "$@"; then
    echo "--- $name: passed on rerun - FLAKY, fix it"
    FLAKY+=("$name")
    return 0
  fi
  echo "--- $name: FAILED twice" >&2
  return 1
}

fail() { echo "" >&2; echo "gates: $1 failed on $SHA. Nothing was stamped; the push will be refused." >&2; exit 1; }

run_gate "jest"       npx jest --silent                              || fail "jest"
run_gate "typescript" npx tsc --noEmit -p .                           || fail "typescript"
run_gate "lint"       npx next lint                                   || fail "lint"
run_gate "build"      env NODE_OPTIONS=--max-old-space-size=8192 npx next build || fail "build"
run_gate "phone suite" npx playwright test                            || fail "phone suite"

# Nothing may have changed while the gates ran (a build or test must not dirty the tree).
if [ "$(git rev-parse HEAD)" != "$SHA" ] || [ -n "$(git status --porcelain)" ]; then
  echo "gates: the tree or HEAD changed while the gates ran; not stamping." >&2
  git status --short >&2
  exit 1
fi

date -u +%FT%TZ > "$STAMP"
echo ""
echo "gates: ALL PASSED on $SHA"
if [ "${#FLAKY[@]}" -gt 0 ]; then echo "gates: flaky (passed only on rerun): ${FLAKY[*]}"; fi
