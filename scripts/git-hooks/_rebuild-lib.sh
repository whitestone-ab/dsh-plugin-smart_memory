#!/bin/sh
# Shared helper: rebuild lib/ so a `link:`-ed plugin never runs stale JS.
# Invoked by post-checkout, post-merge and post-rewrite.
# Never fails the git operation: a broken build is reported, not fatal.

[ -f package.json ] || exit 0

# Skip work that cannot possibly matter (docs-only merges still rebuild, cheap enough).
command -v pnpm >/dev/null 2>&1 || {
  echo "[smart-memory] pnpm not found; lib/ was NOT rebuilt" >&2
  exit 0
}

echo "[smart-memory] rebuilding lib/ after git update ..."
if pnpm run build >/tmp/smart-memory-build.log 2>&1; then
  echo "[smart-memory] lib/ rebuilt — restart DSH to load it"
else
  echo "[smart-memory] BUILD FAILED — lib/ may be stale or broken:" >&2
  tail -n 20 /tmp/smart-memory-build.log >&2
fi
exit 0
