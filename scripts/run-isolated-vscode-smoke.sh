#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="${AGENT_OFFICE_SMOKE_TMP_ROOT:-$(mktemp -d /tmp/agent-office-smoke.XXXXXX)}"
artifacts_dir="$tmp_root/artifacts"
user_data_dir="$tmp_root/user-data"
extensions_dir="$tmp_root/extensions"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

isolated_pids() {
  ps -eo pid=,args= | awk -v dir="$user_data_dir" 'index($0, dir) > 0 { print $1 }'
}

cleanup() {
  mapfile -t pids < <(isolated_pids)
  if ((${#pids[@]} == 0)); then
    return
  fi

  kill "${pids[@]}" 2>/dev/null || true
  sleep 2

  mapfile -t pids < <(isolated_pids)
  if ((${#pids[@]} > 0)); then
    kill -9 "${pids[@]}" 2>/dev/null || true
  fi
}

for command_name in code import xdotool xvfb-run; do
  require_command "$command_name"
done

code_bin="$(command -v code)"
import_bin="$(command -v import)"
xdotool_bin="$(command -v xdotool)"
xvfb_run_bin="$(command -v xvfb-run)"

mkdir -p "$artifacts_dir" "$user_data_dir" "$extensions_dir"

trap cleanup EXIT INT TERM

"$xvfb_run_bin" -a bash -c '
set -euo pipefail

workspace_root="$1"
tmp_root="$2"
code_bin="$3"
xdotool_bin="$4"
import_bin="$5"
artifacts_dir="$tmp_root/artifacts"
user_data_dir="$tmp_root/user-data"
extensions_dir="$tmp_root/extensions"

"$code_bin" --new-window \
  --disable-gpu \
  --disable-extensions \
  --user-data-dir "$user_data_dir" \
  --extensions-dir "$extensions_dir" \
  --extensionDevelopmentPath "$workspace_root" \
  "$workspace_root" \
  >"$artifacts_dir/code.stdout" 2>"$artifacts_dir/code.stderr" &

sleep "${AGENT_OFFICE_SMOKE_BOOT_SECONDS:-20}"

wid="$("$xdotool_bin" search --onlyvisible --name "Visual Studio Code" | head -n 1 || true)"
if [[ -z "$wid" ]]; then
  echo "No isolated VS Code window was detected under Xvfb." >&2
  exit 1
fi

"$xdotool_bin" windowactivate "$wid" || true
sleep 1
"$xdotool_bin" key --window "$wid" ctrl+shift+p
sleep 1
"$xdotool_bin" type --window "$wid" --delay 25 "Agent Office: Show Panel"
sleep 1
"$xdotool_bin" key --window "$wid" Return
sleep "${AGENT_OFFICE_SMOKE_PANEL_SECONDS:-8}"

"$import_bin" -display "$DISPLAY" -window root "$artifacts_dir/root.png"
' _ "$workspace_root" "$tmp_root" "$code_bin" "$xdotool_bin" "$import_bin"

echo "Artifacts: $tmp_root"
