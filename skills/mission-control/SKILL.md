---
name: mission-control
description: Use when coordinating tasks with other agents, checking task queue, reporting status, or interacting with Mission Control — the shared agent orchestration dashboard at http://localhost:3001.
---

# Mission Control

Shared agent orchestration dashboard at `http://localhost:3001`. Use the CLI, not the MCP server.

Profile auto-loaded from `~/.mission-control/profiles/default.json`.

`mc` is available at `~/.local/bin/mc` — no alias needed.

## Arguments

When invoked with an argument, act on it immediately without asking:

**Presence & Health**

| Argument | Action |
|---|---|
| `status` | `mc status health` + `mc agents list` + active tasks summary |
| `overview` | `mc status overview --json` — uptime, memory, disk, sessions |
| `online` | `~/.agents/hooks/mission-control-copilot.sh start` |
| `offline` | `~/.agents/hooks/mission-control-copilot.sh stop` |
| `heartbeat` | `~/.agents/hooks/mission-control-copilot.sh status` |
| `connect` | `mc connect list --json` — all registered agent connections |
| `watch` | `mc events watch --types agent,task` — live event stream |

**Tasks**

| Argument | Action |
|---|---|
| `queue` | `mc tasks queue --agent copilot-cli` — pick up top assigned task |
| `tasks` | `mc tasks list --json` — all active (non-done) tasks |
| `task <id>` | `mc tasks get --id <id>` + `mc tasks comments list --id <id>` |
| `pick <id>` | `mc tasks update --id <id> --body '{"status":"in_progress","assigned_to":"copilot-cli"}'` |
| `done <id> <resolution>` | `mc tasks update --id <id> --body '{"status":"done","resolution":"..."}'` |
| `comment <id> <text>` | `mc tasks comments add --id <id> --content "..."` |
| `create <title>` | `mc tasks create --title "..."` |
| `broadcast <id> <msg>` | `mc tasks broadcast --id <id> --message "..."` — notify all agents |

**Agents**

| Argument | Action |
|---|---|
| `agents` | `mc agents list --json` — all agents with status |
| `agent <name>` | Look up agent by name, show full details |
| `wake <name>` | `mc agents wake --id <id>` — wake a sleeping agent |
| `diagnose <name>` | `mc agents diagnostics --id <id>` |
| `memory <name>` | `mc agents memory get --id <id>` — read agent working memory |
| `memory set <name> <text>` | `mc agents memory set --id <id> --content "..."` |
| `memory clear <name>` | `mc agents memory clear --id <id>` |
| `soul <name>` | `mc agents soul get --id <id>` — read agent persona |
| `soul set <name> <template>` | `mc agents soul set --id <id> --template <t>` |
| `soul templates` | `mc agents soul templates` — list available personas |

**Skills & Costs**

| Argument | Action |
|---|---|
| `skills` | `mc skills list --json` — MC-registered skills (not local SKILL.md files) |
| `costs` | `mc tokens agent-costs --timeframe week` — per-agent cost breakdown |
| `sessions` | `mc sessions list --json` |

## First Moves

1. Check MC is up:
   ```bash
   mc status health
   ```
2. Bring Copilot online (register + start heartbeat loop):
   ```bash
   ~/.agents/hooks/mission-control-copilot.sh start
   ```
3. Check your task queue:
   ```bash
   mc tasks queue --agent copilot-cli --json
   ```

> **Plugin install (one-time):** If hooks aren't wiring automatically, install the MC plugin:
> `/plugin install --path /home/yarin/Projects/mission-control/.claude-plugin/`

## Common Commands

```bash
# Presence
mc agents list --json
mc agents heartbeat --id <id>
mc agents update --id <id> --body '{"status":"offline"}'

# Tasks
mc tasks list --json
mc tasks queue --agent copilot-cli --json
mc tasks get --id <id>
mc tasks create --title "..."
mc tasks create --body '{"title":"...","description":"...","assigned_to":"<agent-name>","priority":"high"}'
mc tasks update --id <id> --body '{"status":"in_progress"}'
mc tasks update --id <id> --body '{"status":"done","resolution":"..."}'
mc tasks comments add --id <id> --content "..."
```

## Hook Helper

```bash
~/.agents/hooks/mission-control-copilot.sh start      # register + heartbeat + background loop
~/.agents/hooks/mission-control-copilot.sh heartbeat  # one-off heartbeat
~/.agents/hooks/mission-control-copilot.sh stop       # kill loop + mark offline
~/.agents/hooks/mission-control-copilot.sh status     # check loop + agent state
~/.agents/hooks/mission-control-copilot.sh queue      # poll assigned tasks
```

## Task Lifecycle

```
inbox → assigned → in_progress → review → done
                                    ↓
                               rejected → assigned (retry with feedback)
```

Mark `in_progress` before starting work. Mark `done` when complete with a resolution note.

## Agent IDs

Always look up dynamically — IDs are instance-specific:

```bash
mc agents list --json | python3 -c "import json,sys; [print(a['id'], a['name']) for a in json.load(sys.stdin)['data']['agents']]"
```

## Coordination Pattern

1. Another agent creates a task: `mc tasks create --body '{"title":"...","assigned_to":"copilot-cli"}'`
2. Copilot polls: `mc tasks queue --agent copilot-cli --json`
3. Copilot claims it: `mc tasks update --id <id> --body '{"status":"in_progress"}'`
4. Copilot finishes: `mc tasks update --id <id> --body '{"status":"done","resolution":"..."}'`

## When MC Is Down

`mc status health` exits non-zero. Don't block on MC — skip MC operations gracefully and continue the coding task. Report that MC was unavailable.

---

## Agent Memory & Soul

Working memory is per-agent scratch space. Soul is the agent's persistent persona.

```bash
# Working memory
mc agents memory get --id <id>
mc agents memory set --id <id> --content "currently working on feature X, branch: feat/x"
mc agents memory clear --id <id>

# Soul / persona
mc agents soul get --id <id>
mc agents soul templates                      # list: operator, assistant, researcher, ...
mc agents soul set --id <id> --template operator
```

## Events & Monitoring

```bash
mc events watch --types agent,task            # live stream of all agent/task changes
mc events watch --types task                  # task updates only
mc status overview --json                     # uptime, memory, disk, active sessions
mc status dashboard                           # full system dashboard
mc status models                              # available LLM models via gateway
mc status capabilities                        # enabled feature flags
```

## Skills Management

MC has its own skill registry (separate from local `SKILL.md` files):

```bash
mc skills list --json                         # all registered skills
mc skills content --name <skill-name>         # read a skill's content
mc skills upsert --name <n> --content "..."   # create or update
mc skills check --name <n>                    # check if skill exists
mc skills delete --name <n>
```

## Connect & Sessions

```bash
mc connect list --json                        # all active agent connections
mc connect disconnect --id <id>               # drop a connection

mc sessions list --json                       # recent sessions
mc sessions transcript --kind claude-code --id <session-id>
```

## Rarely Needed

```bash
# Cost tracking
mc tokens agent-costs --timeframe week        # per-agent token spend
mc tokens task-costs --timeframe week         # per-task token spend
mc tokens export --format csv                 # export for analysis

# Cron jobs
mc cron list --json
mc cron create --body '{"name":"...","schedule":"0 * * * *","command":"..."}'
mc cron pause --id <id>
mc cron run --id <id>                         # run immediately

# Export
mc export tasks --format json
mc export audit --timeframe week

# Raw API fallback
mc raw --method GET --path /api/agents
mc raw --method POST --path /api/tasks --body '{"title":"..."}'
```
