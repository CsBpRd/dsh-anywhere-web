#!/usr/bin/env bash
# dsh-anywhere-web — one-line installer
#
#   curl -fsSL https://raw.githubusercontent.com/CsBpRd/dsh-anywhere-web/main/install.sh | bash
#
# Env:
#   DSH_HOME     dsh home (default ~/.dsh)
#   DSH_PROFILE  target profile (default web)
#   DSH_NO_RESTART=1  skip restarting a running dsh web server
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGIN_SPEC="github:CsBpRd/dsh-anywhere-web#main"

say() { printf '\033[1;32m[dsh-anywhere-web]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dsh-anywhere-web]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is required"
command -v dsh >/dev/null 2>&1 || die "dsh CLI not found — install DeepSeek Harness first"

say "installing into profile: $PROFILE"

# Install the bundle into the profile (initializes the profile on first use
# and appends the plugin to dsh.profile.bundles, since it declares dsh.bundle).
if ! dsh plugin --profile "$PROFILE" add "$PLUGIN_SPEC"; then
  die "dsh plugin add failed — if pnpm demanded a build authorization, add the printed package key to '$PROFILE_DIR/pnpm-workspace.yaml' under allowBuilds, then re-run; also check GitHub access (VPN/proxy)"
fi

say "plugin installed into bundles"

# Restart a running dsh web server so the plugin loads.
if [ "${DSH_NO_RESTART:-}" = "1" ]; then
  say "restart skipped (DSH_NO_RESTART=1) — restart dsh web manually to load it"
  exit 0
fi

RESTARTED=0
# LaunchAgent-managed instance (e.g. com.cbr.dsh-web) → kickstart reloads it.
if command -v launchctl >/dev/null 2>&1; then
  LABEL="$(launchctl list 2>/dev/null | awk '/dsh-web/ && !/awk/ {print $3; exit}')"
  if [ -n "$LABEL" ]; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL" && RESTARTED=1
    say "restarted LaunchAgent $LABEL"
  fi
fi
# Fallback: relaunch with the instance's own command line.
if [ "$RESTARTED" = "0" ]; then
  PID="$(ps aux | awk '/bin\/dsh web/ && !/awk/ {print $2; exit}')"
  if [ -n "$PID" ]; then
    CMD="$(ps -o command= -p "$PID" | tr -d '\n')"
    CWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | tail -n1 | cut -c2-)"
    [ -n "$CWD" ] && [ -d "$CWD" ] || CWD="$HOME"
    kill "$PID" 2>/dev/null || true
    sleep 2
    ( cd "$CWD" && nohup $CMD >/tmp/dsh-web.log 2>&1 & ) || true
    sleep 4
    say "dsh web restarted with its own command line"
  else
    say "no running dsh web found — start it with: dsh web"
  fi
fi

say "done. Verify: curl -sS http://127.0.0.1:3080/ | grep randomUUID"
