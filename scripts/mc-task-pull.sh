#!/bin/bash
# Mission Control task puller — fetch assigned tasks for the current agent
# Usage: mc-task-pull.sh [--pull-on-start] [--agent-name NAME]
# Call from session-start hook (--pull-on-start) or heartbeat hook (default behavior)

set -euo pipefail

PROFILE="${HOME}/.mission-control/profiles/default.json"
STATE="/tmp/mc-${AGENT_NAME:-claude-code}-session.json"
TASKS_STATE="/tmp/mc-${AGENT_NAME:-claude-code}-tasks.json"

# Defaults
AGENT_NAME="${AGENT_NAME:-claude-code}"
PULL_ON_START=0
MAX_CAPACITY=1

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull-on-start) PULL_ON_START=1; shift ;;
    --agent-name) AGENT_NAME="$2"; shift 2 ;;
    --max-capacity) MAX_CAPACITY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Exit silently if MC not configured
[ -f "$PROFILE" ] || exit 0

MC_URL=$(python3 -c "import json; d=json.load(open('$PROFILE')); print(d['url'])" 2>/dev/null) || exit 0
MC_KEY=$(python3 -c "import json; d=json.load(open('$PROFILE')); print(d['apiKey'])" 2>/dev/null) || exit 0

[ -n "$MC_URL" ] && [ -n "$MC_KEY" ] || exit 0

# Throttle polling: don't fetch more than once every 15 seconds
if [ -f "$TASKS_STATE" ] && [ "$PULL_ON_START" -eq 0 ]; then
  MTIME=$(stat -c %Y "$TASKS_STATE" 2>/dev/null || echo 0)
  AGE=$(( $(date +%s) - MTIME ))
  [ "$AGE" -lt 15 ] && exit 0
fi

# Fetch task(s) for this agent from the queue
RESP=$(curl -sf -X GET "$MC_URL/api/tasks/queue?agent=${AGENT_NAME}&max_capacity=${MAX_CAPACITY}" \
  -H "x-api-key: $MC_KEY" \
  --connect-timeout 2 --max-time 5 2>/dev/null) || exit 0

# Parse response: the queue endpoint returns a JSON object
# Structure: { task: {...} | null, reason?: string, ... }
TASK_INFO=$(echo "$RESP" | python3 -c "
import json, sys
try:
  resp = json.load(sys.stdin)

  # Handle both raw response and mc-cli wrapped response
  if 'data' in resp and isinstance(resp['data'], dict):
    task = resp['data'].get('task')
    reason = resp['data'].get('reason', 'unknown')
  else:
    # Raw API response (curl)
    task = resp.get('task') if isinstance(resp.get('task'), dict) else None
    reason = resp.get('reason', 'unknown')

  # Save for heartbeat monitoring
  with open('$TASKS_STATE', 'w') as f:
    json.dump({
      'current_task': task,
      'reason': reason,
      'fetched_at': int(__import__('time').time())
    }, f)

  # Return task ID if present
  if task and task.get('id'):
    print(str(task.get('id')))
except Exception as e:
  pass
" 2>/dev/null) || echo ""

# On session start, display what was found
if [ "$PULL_ON_START" -eq 1 ] && [ -n "$TASK_INFO" ]; then
  echo ""
  echo "📋 Mission Control: New task for $AGENT_NAME"
  python3 - "$TASKS_STATE" <<'EOF' 2>/dev/null || true
import json, sys
try:
  with open(sys.argv[1]) as f:
    data = json.load(f)
    task = data.get('current_task', {})
    if task:
      tid = task.get('id')
      title = task.get('title', '')[:60]
      status = task.get('status', '')
      reason = data.get('reason', '')
      print(f"  • TASK-{tid:03d} [{status:10}] {title}")
      print(f"    Reason: {reason}")
      # Show checkpoint if available
      desc = task.get('description', '')
      if 'CHECKPOINT' in desc:
        lines = [l.strip() for l in desc.split('\n') if 'CHECKPOINT' in l]
        if lines:
          print(f"    {lines[0]}")
except:
  pass
EOF
  echo ""
fi

exit 0
