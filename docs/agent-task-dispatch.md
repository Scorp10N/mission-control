# Agent Task Dispatch: Heartbeat + Task Polling

## Overview

Mission Control agents now use a **heartbeat + task-polling** mechanism to discover and pull assigned work, eliminating the need for a centralized auto-dispatch system that requires OpenClaw CLI.

## How It Works

### 1. Session Start (`mc-session-start` hook)
When an agent session begins:
- Agent connects to MC via `/api/connect`
- Immediately pulls assigned tasks via `mc-task-pull.sh --pull-on-start`
- Displays the first available task with its CHECKPOINT criteria
- Agent can start work immediately

### 2. Heartbeat (`mc-heartbeat` hook)
Every 25 seconds:
- Agent sends heartbeat to `/api/agents/{id}/heartbeat`
- Heartbeat hook also triggers task polling
- New tasks are fetched and cached locally (throttled to 15s min)
- Agent can check for new work or task updates during execution

### 3. Task Queue API (`GET /api/tasks/queue`)
Agents pull work via the queue endpoint:
```bash
mc tasks queue --agent codex --json
```

Response format:
```json
{
  "ok": true,
  "data": {
    "task": {
      "id": 29,
      "title": "...",
      "description": "... CHECKPOINT: criteria for completion ...",
      "status": "assigned|in_progress",
      "assigned_to": "codex"
    },
    "reason": "new|continue_current",
    "timestamp": 1779975852
  }
}
```

## Agent Workflow

### Step 1: Session Start
```bash
# User starts Claude Code session
# mc-session-start hook runs:
# 1. Registers agent with MC
# 2. Calls mc-task-pull.sh --pull-on-start
# Output:
# 📋 Mission Control: New task for codex
#   • TASK-029 [assigned] MC: implement agent-limits.ts...
#     CHECKPOINT: isAgentOverLimit, getWeeklyUsage tested and passing
```

### Step 2: Read Task Description
Task description contains:
- Plan file reference
- Task number and track
- Dependencies (if any)
- **CHECKPOINT** — completion criteria

```markdown
Plan: docs/superpowers/plans/2026-05-28-mc-foundations.md — Task A-2
Depends on A-1 (TASK-28).
CHECKPOINT: isAgentOverLimit, getWeeklyUsage, setAgentLimit all tested and passing.
```

### Step 3: Execute Work
Agent implements the task according to the plan. When CHECKPOINT criteria are met:

```bash
# Mark task as in_progress
mc tasks update --id 29 --body '{"status":"in_progress"}'

# Do the work...
pnpm test src/lib/__tests__/agent-limits.test.ts

# When complete, mark as done
mc tasks update --id 29 --body '{"status":"done","resolution":"All tests passing"}'
```

### Step 4: Heartbeat Keeps Tasks Fresh
While agent works, heartbeat hook:
- Maintains connection to MC (every 25s)
- Polls for task updates
- Keeps session alive and shows as "online"

## Implementation Details

### Scripts

**`scripts/mc-task-pull.sh`** — Core task-pulling script
```bash
AGENT_NAME=codex mc-task-pull.sh --pull-on-start
```

Options:
- `--pull-on-start` — Display tasks on session init (verbose)
- `--agent-name NAME` — Specify agent name
- `--max-capacity N` — Max tasks to pull (default: 1)

Behavior:
- Throttles polling to 15s minimum between fetches
- Silently exits if MC is unavailable
- Caches task state in `/tmp/mc-{agent}-tasks.json`

### Hooks

**`mc-session-start.sh`** — Called when agent session starts
1. Registers agent via `/api/connect`
2. Pulls tasks via `mc-task-pull.sh --pull-on-start`
3. Displays available work

**`mc-heartbeat.sh`** — Called every 25 seconds
1. Posts heartbeat to `/api/agents/{id}/heartbeat`
2. Polls tasks via `mc-task-pull.sh`
3. Updates local cache

### Agent Registration

Agents are registered with roles:
- **codex** — implementation, testing, refactoring
- **copilot-cli** — CLI/scripting, quick implementation
- **pi** — documentation, architecture decisions
- **hermes** — coordination, monitoring, dispatch
- **claude-code** — general tasks, handoff coordination

## Advantages Over Auto-Dispatch

| Feature | Auto-Dispatch (OpenClaw) | Heartbeat + Polling |
|---------|--------------------------|---------------------|
| Dependency | Requires openclaw CLI | No external tools |
| Initialization | Gateway-driven | Agent-driven |
| Control | Centralized | Distributed |
| Failure Mode | Dispatch fails silently | Agent can retry manually |
| Transparency | Hidden in gateway logs | Visible in agent session |
| Flexibility | Rigid assignment | Agent can defer/reject |

## Monitoring Task Progress

### Check current task
```bash
mc tasks queue --agent codex --json
```

### List all tasks
```bash
mc tasks list --json | grep TASK-2[0-9]
```

### Watch task updates
```bash
watch 'mc tasks get --id 29 --json | jq ".data.task.status"'
```

### See task log
```bash
mc tasks comments list --id 29 --json
```

## Example: Codex Working on TASK-29

```
📋 Session started for codex agent
✓ Connected to Mission Control (agent_id=4)
✓ Pulling tasks...

📋 Mission Control: New task for codex
  • TASK-029 [assigned] MC: implement agent-limits.ts weekly enforcement
    Reason: assigned
    CHECKPOINT: isAgentOverLimit, getWeeklyUsage, setAgentLimit all tested and passing.

[Agent reads plan and starts implementing...]
  - Creates src/lib/agent-limits.ts
  - Writes tests
  - Runs pnpm test

✓ Tests passing
[Agent updates task]
% mc tasks update --id 29 --body '{"status":"in_progress"}'
% mc tasks update --id 29 --body '{"status":"done"}'

✓ TASK-29 complete

[Heartbeat polls for next task...]
📋 Mission Control: New task for codex
  • TASK-030 [assigned] MC: add /api/limits and /api/limits/usage endpoints
```

## Troubleshooting

### Task queue returns no task
**Issue**: Agent pulls but gets empty response
```bash
AGENT_NAME=codex mc-task-pull.sh --pull-on-start
# No output — no task available
```

**Solutions**:
1. Check task assignments: `mc tasks list --json | grep codex`
2. Verify agent status: `mc agents list --json | grep codex`
3. Check if tasks are in "assigned" state (not "done" or "failed")

### Heartbeat not polling
**Issue**: Heartbeat hook exists but not running
```bash
ls -la ~/.claude/hooks/mc-*.sh  # should show files
```

**Solutions**:
1. Ensure hooks are executable: `chmod +x ~/.claude/hooks/mc-*.sh`
2. Check MC profile exists: `cat ~/.mission-control/profiles/default.json`
3. Verify MC is running: `curl http://127.0.0.1:3001/api/status`

### Task state stale
**Issue**: Agent sees old task info after update
```bash
rm /tmp/mc-{agent}-tasks.json  # clear cache
AGENT_NAME={agent} mc-task-pull.sh  # refetch
```

## Future Enhancements

- [ ] Webhook-based task notifications (instead of polling)
- [ ] Agent-to-agent task handoff protocol
- [ ] Task state machine with explicit transitions
- [ ] Distributed agent coordination (multi-process)
- [ ] Resource-aware task assignment (CPU, memory)
