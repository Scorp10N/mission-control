---
name: mission-control
description: Use when coordinating Codex with Mission Control, checking or updating the shared task queue, registering Codex presence, sending heartbeats, or handing work to other local/cloud agents.
---

# Mission Control

Use the local Mission Control CLI, not the MCP server, for Codex coordination.

## Defaults

- Mission Control URL: `http://127.0.0.1:3001`
- CLI: `mc`
- Profile: `~/.mission-control/profiles/default.json`
- Codex agent name: `codex`
- Codex hook helper: `/home/yarin/.codex/hooks/mission-control-codex.sh`

Do not print API keys. Prefer the default profile or `MC_API_KEY` from the environment.

## First Moves

1. Check health quickly:
   ```bash
   mc status health --url http://127.0.0.1:3001 --json
   ```
2. Bring Codex online:
   ```bash
   /home/yarin/.codex/hooks/mission-control-codex.sh start
   ```
3. Check the Codex queue:
   ```bash
   mc tasks queue --agent codex --url http://127.0.0.1:3001 --json
   ```

If Mission Control is down or blocked by sandbox networking, do not block the coding task. Report that MC was unavailable and continue with local evidence.

## Common Commands

```bash
# Health and presence
mc status health --json
mc agents list --json
/home/yarin/.codex/hooks/mission-control-codex.sh heartbeat
/home/yarin/.codex/hooks/mission-control-codex.sh stop

# Tasks
mc tasks list --json
mc tasks queue --agent codex --json
mc tasks get --id <id>
mc tasks create --body '{"title":"...","description":"...","assigned_to":"claude-code","priority":"medium"}'
mc tasks update --id <id> --body '{"status":"in_progress"}'
mc tasks update --id <id> --body '{"status":"done","resolution":"..."}'
mc tasks comments add --id <id> --content "..."
```

The CLI requires `--body '{...}'` for multi-field create/update operations.

## Coordination Rules

- Look up agent IDs dynamically with `mc agents list`; do not hardcode IDs in plans or docs.
- Mark a task `in_progress` before doing meaningful work.
- Mark it `review` when another agent/user should inspect it, or `done` only when the requested work and verification are complete.
- Use comments for handoffs: include repo path, branch/worktree, exact verification run, and remaining blockers.
- Keep upstream repository boundaries explicit. For Mission Control code changes, use the user's fork/local branch unless asked otherwise.

## Hook Helper

The Codex helper supports:

```bash
/home/yarin/.codex/hooks/mission-control-codex.sh start
/home/yarin/.codex/hooks/mission-control-codex.sh heartbeat
/home/yarin/.codex/hooks/mission-control-codex.sh stop
/home/yarin/.codex/hooks/mission-control-codex.sh status
/home/yarin/.codex/hooks/mission-control-codex.sh queue
```

`start` registers/refreshes the `codex` direct connection, sends a heartbeat, and starts a background heartbeat loop if one is not already running.
