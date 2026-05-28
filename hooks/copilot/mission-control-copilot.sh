#!/usr/bin/env bash
set -u

MC_URL="${MC_URL:-http://127.0.0.1:3001}"
MC_CLI="${MC_CLI:-/home/yarin/Projects/mission-control/scripts/mc-cli.cjs}"
MC_AGENT_NAME="${MC_AGENT_NAME:-copilot-cli}"
MC_AGENT_ROLE="${MC_AGENT_ROLE:-developer}"
MC_HEARTBEAT_INTERVAL="${MC_HEARTBEAT_INTERVAL:-60}"
MC_TIMEOUT_MS="${MC_TIMEOUT_MS:-5000}"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/mission-control-copilot"
CONNECTION_FILE="$STATE_DIR/connection.json"
PID_FILE="$STATE_DIR/heartbeat.pid"
LOG_FILE="$STATE_DIR/heartbeat.log"
UNIT_NAME="mission-control-copilot-heartbeat.service"

mkdir -p "$STATE_DIR"

mc() {
  node "$MC_CLI" "$@" --url "$MC_URL" --json --timeout-ms "$MC_TIMEOUT_MS"
}

json_field() {
  node -e '
const field = process.argv[1];
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const data = JSON.parse(input || "{}");
  const parts = field.split(".");
  let cur = data;
  for (const part of parts) cur = cur?.[part];
  if (cur === undefined || cur === null) process.exit(1);
  process.stdout.write(String(cur));
});
' "$1"
}

agent_id_from_list() {
  node -e '
const name = process.env.MC_AGENT_NAME || "copilot-cli";
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const parsed = JSON.parse(input || "{}");
  const agents = parsed.data?.agents || parsed.agents || [];
  const agent = agents.find(item => item.name === name);
  if (!agent?.id) process.exit(1);
  process.stdout.write(String(agent.id));
});
'
}

current_agent_id() {
  local id
  if [ -s "$CONNECTION_FILE" ]; then
    id="$(json_field data.agent_id < "$CONNECTION_FILE" 2>/dev/null || true)"
    [ -n "$id" ] && printf '%s\n' "$id" && return 0
  fi
  id="$(mc agents list 2>/dev/null | agent_id_from_list 2>/dev/null || true)"
  [ -n "$id" ] && printf '%s\n' "$id"
}

register_agent() {
  local body
  body="$(printf '{"tool_name":"copilot-cli","agent_name":"%s","agent_role":"%s","metadata":{"workspace":"%s","pid":%s}}' \
    "$MC_AGENT_NAME" "$MC_AGENT_ROLE" "${PWD:-}" "$$")"
  mc connect register --body "$body" > "$CONNECTION_FILE"
}

send_heartbeat() {
  local id
  id="$(current_agent_id || true)"
  if [ -z "${id:-}" ]; then
    register_agent >/dev/null || return 1
    id="$(current_agent_id || true)"
  fi
  [ -n "${id:-}" ] || return 1
  mc agents heartbeat --id "$id" >/dev/null
}

loop_alive() {
  local pid
  if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    return 0
  fi
  [ -s "$PID_FILE" ] || return 1
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_loop() {
  if loop_alive; then
    return 0
  fi
  if command -v systemd-run >/dev/null 2>&1; then
    rm -f "$PID_FILE"
    systemd-run --user --unit "${UNIT_NAME%.service}" --collect \
      --property Restart=always --property RestartSec=5 \
      "$0" loop >/dev/null 2>&1 && return 0
  fi
  setsid -f "$0" loop >/dev/null 2>&1 &
  printf '%s\n' "$!" > "$PID_FILE"
}

stop_loop() {
  local pid id
  if loop_alive; then
    if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
      systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || true
    fi
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  id="$(current_agent_id || true)"
  if [ -n "${id:-}" ]; then
    mc agents update --id "$id" --body '{"status":"offline"}' >/dev/null 2>&1 || true
  fi
}

case "${1:-heartbeat}" in
  start)
    register_agent >/dev/null || exit 1
    send_heartbeat || exit 1
    start_loop
    printf 'mission-control copilot-cli heartbeat started\n'
    ;;
  heartbeat)
    send_heartbeat || exit 1
    printf 'mission-control copilot-cli heartbeat ok\n'
    ;;
  loop)
    while true; do
      date -Is >> "$LOG_FILE"
      "$0" heartbeat >> "$LOG_FILE" 2>&1 || true
      sleep "$MC_HEARTBEAT_INTERVAL"
    done
    ;;
  stop)
    stop_loop
    printf 'mission-control copilot-cli heartbeat stopped\n'
    ;;
  status)
    if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
      printf 'heartbeat loop running service=%s\n' "$UNIT_NAME"
    elif loop_alive; then
      printf 'heartbeat loop running pid=%s\n' "$(cat "$PID_FILE")"
    else
      printf 'heartbeat loop not running\n'
    fi
    current_agent_id >/dev/null 2>&1 && mc agents list || true
    ;;
  queue)
    mc tasks queue --agent "$MC_AGENT_NAME"
    ;;
  *)
    printf 'usage: %s start|heartbeat|stop|status|queue\n' "$0" >&2
    exit 2
    ;;
esac
