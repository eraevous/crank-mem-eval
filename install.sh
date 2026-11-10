#!/bin/sh
# crank-mem installer: one command, per user, no sudo.
#
# Added in aegis/safety-fixes (see ATTRIBUTION.md). Read it before you run it:
#   curl -fsSLO <raw URL of this file> && less install.sh && sh install.sh
#
# What it does, in order (nothing outside the two directories below is touched):
#   1. Preflight, read-only: git, a runtime (bun, or node >= 23.6), writable install dirs.
#   2. Clones the chosen ref into  $PREFIX/versions/<commit>/  (a fresh directory per commit),
#      and, with --sha, refuses unless the checked-out commit is exactly that one.
#   3. Runs `crank-mem setup --core` there (packages from the lockfile; add --with-dashboard /
#      --with-model for the optional parts). If setup fails, nothing is switched.
#   4. Switches  $PREFIX/current  to the new version atomically, remembering the old one,
#      and links  $BIN_DIR/crank-mem -> $PREFIX/current/bin/crank-mem  (once; it never moves).
#
# Re-running is safe: the same commit is reused if its install finished, redone if it did not.
# Upgrade = run it again with a newer --ref; then `crank-mem upgrade` in each project.
# --rollback switches back to the previous version. --uninstall removes the install (not your
# projects' wiring: run `crank-mem uninstall` in each project first; ~/.crank is left alone).
#
# Projects record the version directory they were set up from, so old versions are kept until
# you run --prune (which keeps the current and previous ones).

set -eu

REPO_DEFAULT="https://github.com/ChrisLiva/crank-mem"
REPO="$REPO_DEFAULT"
REF="main"
SHA=""
YES=0
ACTION="install"
SETUP_FLAGS="--core"
WITH_DASHBOARD=0
WITH_MODEL=0
PREFIX="${CRANK_INSTALL_PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/crank-mem}"
BIN_DIR="${CRANK_INSTALL_BIN_DIR:-$HOME/.local/bin}"

say() { printf 'crank-mem install: %s\n' "$*"; }
die() { printf 'crank-mem install: error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sh install.sh [--ref <branch|tag|commit>] [--sha <full commit>] [--repo <url|path>]
                     [--with-dashboard] [--with-model] [--yes]
       sh install.sh --rollback | --status | --prune | --uninstall [--yes]
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || die "--ref needs a value"; REF="$2"; shift 2 ;;
    --sha) [ $# -ge 2 ] || die "--sha needs a value"; SHA="$2"; shift 2 ;;
    --repo) [ $# -ge 2 ] || die "--repo needs a value"; REPO="$2"; shift 2 ;;
    --with-dashboard) WITH_DASHBOARD=1; shift ;;
    --with-model) WITH_MODEL=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --rollback) ACTION="rollback"; shift ;;
    --status) ACTION="status"; shift ;;
    --prune) ACTION="prune"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

VERSIONS="$PREFIX/versions"
CURRENT="$PREFIX/current"
PREVIOUS_FILE="$PREFIX/previous"
LINK="$BIN_DIR/crank-mem"

# Point symlink $2 at $1 atomically: build it beside, then rename over (GNU mv -T, BSD mv -h).
swap_link() {
  tmp="$2.tmp.$$"
  ln -sfn "$1" "$tmp"
  mv -fT "$tmp" "$2" 2>/dev/null || mv -fh "$tmp" "$2" 2>/dev/null || {
    rm -f "$tmp"; die "could not switch $2"
  }
}

current_target() { [ -L "$CURRENT" ] && readlink "$CURRENT" || true; }

confirm() {
  [ "$YES" = 1 ] && return 0
  [ -t 0 ] || die "$1 — re-run with --yes to confirm"
  printf '%s [y/N] ' "$1"
  read -r answer
  case "$answer" in y|Y|yes) return 0 ;; *) die "stopped" ;; esac
}

# The bin link is ours when it points at $CURRENT/bin/crank-mem; anything else is left alone.
link_is_ours() { [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$CURRENT/bin/crank-mem" ]; }

case "$ACTION" in
  status)
    say "prefix:   $PREFIX"
    say "current:  $(current_target || echo none)"
    say "previous: $(cat "$PREVIOUS_FILE" 2>/dev/null || echo none)"
    [ -d "$VERSIONS" ] && for v in "$VERSIONS"/*; do
      [ -e "$v" ] || continue
      state="complete"; [ -f "$v/.crank-install-complete" ] || state="unfinished"
      say "version:  $(basename "$v") ($state)"
    done
    if link_is_ours; then say "command:  $LINK"; else say "command:  $LINK is not linked by this installer"; fi
    exit 0 ;;

  rollback)
    prev="$(cat "$PREVIOUS_FILE" 2>/dev/null || true)"
    [ -n "$prev" ] && [ -f "$prev/.crank-install-complete" ] || die "no previous version to roll back to"
    cur="$(current_target)"
    swap_link "$prev" "$CURRENT"
    [ -n "$cur" ] && printf '%s\n' "$cur" > "$PREVIOUS_FILE"
    say "rolled back to $(basename "$prev"); run \`crank-mem upgrade\` in each project to match"
    exit 0 ;;

  prune)
    cur="$(current_target)"; prev="$(cat "$PREVIOUS_FILE" 2>/dev/null || true)"
    [ -d "$VERSIONS" ] || exit 0
    for v in "$VERSIONS"/*; do
      [ -e "$v" ] || continue
      if [ "$v" = "$cur" ] || [ "$v" = "$prev" ]; then continue; fi
      confirm "delete $v (projects set up from it will need \`crank-mem upgrade\`)?"
      rm -rf "$v"; say "deleted $(basename "$v")"
    done
    exit 0 ;;

  uninstall)
    [ -d "$PREFIX" ] || [ -L "$LINK" ] || { say "nothing installed"; exit 0; }
    confirm "remove $PREFIX and the crank-mem command? (run \`crank-mem uninstall\` in each project first; ~/.crank stays)"
    if link_is_ours; then rm -f "$LINK"; say "removed $LINK"; fi
    rm -rf "$PREFIX"; say "removed $PREFIX"
    exit 0 ;;
esac

# ── install ──────────────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || die "git is required"
runtime=""
if command -v bun >/dev/null 2>&1; then runtime="bun $(bun --version)"
elif command -v node >/dev/null 2>&1; then
  v="$(node -v | sed 's/^v//')"; major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"
  if [ "$major" -gt 23 ] || { [ "$major" -eq 23 ] && [ "$minor" -ge 6 ]; }; then runtime="node $v"; fi
fi
[ -n "$runtime" ] || die "install bun (https://bun.sh) or node >= 23.6 first"
if [ -e "$LINK" ] && ! link_is_ours; then
  die "$LINK already exists and was not made by this installer; move it aside first"
fi
mkdir -p "$VERSIONS" "$BIN_DIR" || die "cannot create $VERSIONS or $BIN_DIR"
say "runtime $runtime; installing from $REPO ($REF) into $PREFIX"

# Resolve the ref to a commit without touching any installed version.
stage="$PREFIX/.staging.$$"
trap 'rm -rf "$stage"' EXIT INT TERM
git clone --quiet "$REPO" "$stage" || die "could not clone $REPO"
git -C "$stage" -c advice.detachedHead=false checkout --quiet "$REF" 2>/dev/null \
  || git -C "$stage" -c advice.detachedHead=false checkout --quiet "origin/$REF" 2>/dev/null \
  || die "no ref $REF in $REPO"
commit="$(git -C "$stage" rev-parse HEAD)"
if [ -n "$SHA" ] && [ "$commit" != "$SHA" ]; then
  die "$REF is $commit, not the expected $SHA; nothing installed"
fi
target="$VERSIONS/$commit"

if [ -f "$target/.crank-install-complete" ]; then
  say "commit $commit is already installed; reusing it"
  rm -rf "$stage"
else
  # An unfinished earlier attempt at this commit is redone from scratch.
  rm -rf "$target"
  mv "$stage" "$target"
fi
trap - EXIT INT TERM

case "$WITH_DASHBOARD$WITH_MODEL" in
  00) SETUP_FLAGS="--core" ;;
  10) SETUP_FLAGS="--skip-model" ;;
  01) SETUP_FLAGS="--skip-dashboard" ;;
  11) SETUP_FLAGS="" ;;
esac
# CRANK_INSTALL_SETUP replaces the setup command (the installer's tests use it to run offline).
setup_cmd="${CRANK_INSTALL_SETUP:-$target/bin/crank-mem setup $SETUP_FLAGS}"
say "running: $setup_cmd"
if ! (cd "$target" && sh -c "$setup_cmd"); then
  die "setup failed in $target; the current version was not switched (re-run to retry)"
fi
: > "$target/.crank-install-complete"

cur="$(current_target)"
if [ "$cur" != "$target" ]; then
  [ -n "$cur" ] && printf '%s\n' "$cur" > "$PREVIOUS_FILE"
  swap_link "$target" "$CURRENT"
fi
link_is_ours || swap_link "$CURRENT/bin/crank-mem" "$LINK"

say "installed $(git -C "$target" log -1 --format='%h %s' 2>/dev/null || echo "$commit")"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "add $BIN_DIR to your PATH to run crank-mem" ;; esac
if [ -n "$cur" ] && [ "$cur" != "$target" ]; then
  say "upgraded from $(basename "$cur"); run \`crank-mem upgrade\` in each project (or sh install.sh --rollback)"
else
  say "next: cd <your project> && crank-mem init --plan, then crank-mem init"
fi
say "check anything any time with: crank-mem doctor"
