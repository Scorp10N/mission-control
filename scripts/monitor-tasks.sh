#!/bin/bash
# Real-time task progress monitor for MC Foundations tasks
# Shows status of all implementation tasks with live updates

set -euo pipefail

MC_PROFILE="${HOME}/.mission-control/profiles/default.json"
[ -f "$MC_PROFILE" ] || { echo "MC profile not found"; exit 1; }

# Task IDs to monitor (MC Foundations Phase 1)
TASK_IDS=(27 28 29 30 31 32 33 34 35)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Status icons
icon_done="✓"
icon_progress="⏳"
icon_review="🔍"
icon_assigned="○"
icon_failed="✗"
icon_inbox="📋"

get_icon() {
  case "$1" in
    done) echo "✓" ;;
    in_progress) echo "→" ;;
    review|quality_review) echo "🔍" ;;
    assigned) echo "◎" ;;
    failed) echo "✗" ;;
    inbox) echo "○" ;;
    *) echo "?" ;;
  esac
}

get_color() {
  case "$1" in
    done) echo -e "$GREEN" ;;
    in_progress) echo -e "$CYAN" ;;
    review|quality_review) echo -e "$YELLOW" ;;
    assigned) echo -e "$BLUE" ;;
    failed) echo -e "$RED" ;;
    *) echo -e "$RESET" ;;
  esac
}

print_header() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BLUE}MC Foundations Phase 1 — Task Monitor${RESET}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo "$(date '+%Y-%m-%d %H:%M:%S UTC%z') | Press Ctrl+C to stop"
  echo ""
}

print_tasks() {
  mc tasks list --json 2>/dev/null | python3 << 'PYTHON'
import json, sys

data = json.load(sys.stdin)
tasks_by_id = {t['id']: t for t in data.get('data', {}).get('tasks', [])}

# Display order: coordinator first, then tracks A/B/C/E
order = [27, 28, 29, 30, 31, 32, 33, 34, 35]
tracks = {
  27: ("COORD", ""},
  28: ("Track A-1", "cost caps"),
  29: ("Track A-2", "cost caps"),
  30: ("Track A-3", "cost caps"),
  31: ("Track A-4", "cost caps"),
  32: ("Track B-1", "dependencies"),
  33: ("Track B-2", "dependencies"),
  34: ("Track C", "aegis"),
  35: ("Track E", "ADRs"),
}

done_count = 0
total_count = 0

print("\nTasks:")
print()

for task_id in order:
  if task_id not in tasks_by_id:
    continue

  t = tasks_by_id[task_id]
  total_count += 1

  status = t.get('status', 'unknown')
  if status in ['done', 'review']:
    done_count += 1

  # Color codes
  colors = {
    'done': '\033[0;32m',
    'in_progress': '\033[0;36m',
    'review': '\033[1;33m',
    'quality_review': '\033[1;33m',
    'assigned': '\033[0;34m',
    'failed': '\033[0;31m',
    'inbox': '\033[0m',
  }
  color = colors.get(status, '\033[0m')
  reset = '\033[0m'

  icons = {
    'done': '✓',
    'in_progress': '→',
    'review': '🔍',
    'quality_review': '🔍',
    'assigned': '◎',
    'failed': '✗',
    'inbox': '○',
  }
  icon = icons.get(status, '?')

  track, category = tracks.get(task_id, ("Unknown", ""))
  assigned = t.get('assigned_to', 'unassigned')
  title = t.get('title', '')[:45]

  # Error or resolution
  detail = ""
  if status == 'failed':
    error = t.get('error_message', '')[:40]
    detail = f" | ERROR: {error}"
  elif status == 'done':
    res = t.get('resolution', '')[:40]
    if res:
      detail = f" | {res}"

  print(f"  {icon} {color}TASK-{task_id:02d}{reset} [{status:12}] {assigned:15} | {track:12} | {title}{detail}")

print()
print(f"Progress: {done_count}/{total_count} tasks complete ({100*done_count//total_count if total_count else 0}%)")
print()

# Show active tasks
in_progress = [t for t in tasks_by_id.values() if t.get('status') == 'in_progress']
if in_progress:
  print("Currently Working:")
  for t in in_progress:
    print(f"  • {t.get('assigned_to')}: TASK-{t.get('id')} - {t.get('title', '')[:50]}")
  print()

PYTHON
}

main() {
  clear

  while true; do
    print_header
    print_tasks

    # Refresh every 10 seconds
    sleep 10
    clear
  done
}

main
