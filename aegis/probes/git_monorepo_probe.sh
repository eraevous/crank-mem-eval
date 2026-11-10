#!/bin/sh
# Original synthetic probe (not crank-mem code): git behaviour for a project
# rooted in a monorepo subdirectory. Creates a throwaway repo under $TMPDIR.
set -eu
T=$(mktemp -d); cd "$T"
mkdir -p mono/packages/app/src mono/packages/app/.crank && cd mono && git init -q
printf 'packages/app/local-data.csv\n' > .gitignore
echo 'export const a = 1' > packages/app/src/a.ts
echo 'SYNTHETIC,ROW' > packages/app/local-data.csv
# Same *shape* as an allowlist .gitignore: ignore all, re-admit named files.
printf '/*\n!/.gitignore\n!/config.json\n!/cerebrum.md\n!/journal.md\n!/anatomy-index.json\n' > packages/app/.crank/.gitignore
for f in config.json cerebrum.md journal.md anatomy-index.json run.log; do echo synthetic > packages/app/.crank/$f; done
cd packages/app
echo "1) .git at subdir root: $([ -e .git ] && echo yes || echo no)"
echo "2) git ls-files -co --exclude-standard from subdir:"; git ls-files -co --exclude-standard | sed 's/^/   /'
echo "3) plain walk also sees git-ignored: $(ls local-data.csv)"
echo "4) root/.git/info/exclude exists: $([ -e .git/info/exclude ] && echo yes || echo no)"
echo "5) untracked (committable) state files in parent repo:"; git status --porcelain -uall .crank | sed 's/^/   /'
echo "6) toplevel from subdir: $(basename "$(git rev-parse --show-toplevel)")"
echo "7) git failure exit code: $(GIT_DIR=/nonexistent git ls-files >/dev/null 2>&1; echo $?)"
rm -rf "$T"
