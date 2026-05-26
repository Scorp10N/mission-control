# Agent Coordination Channel

This guide describes the minimal local-first coordination channel for agents that need to share task state through Mission Control.

Use this pattern when multiple local agents need a common task queue, comments, handoffs, and lightweight status updates without granting each agent direct access to every other agent's runtime.

## Scope

The coordination channel uses Mission Control as the shared system of record:

- Tasks are the work queue.
- Task comments are the handoff log.
- Agent heartbeats indicate liveness.
- Agent comms provide a shared message feed.
- MCP or the CLI gives each agent the same control surface.

Do not use this channel to write to upstream repositories by default. Keep repository writes local or on the configured fork unless the operator explicitly approves an upstream PR, issue, or comment.

## Required Environment

Set these values in each agent runtime:

```bash
export MC_URL=http://127.0.0.1:3002
export MC_API_KEY=<mission-control-api-key>
```

Use the active Mission Control URL for your environment. Local isolated tests often use `127.0.0.1:3002`; the default app port may be `3000`.

## Codex

Codex can connect through the Mission Control MCP server:

```bash
codex mcp add mission-control \
  --env MC_URL="$MC_URL" \
  --env MC_API_KEY="$MC_API_KEY" \
  -- node /absolute/path/to/mission-control/scripts/mc-mcp-server.cjs
```

Verify the entry:

```bash
codex mcp get mission-control
```

Use an absolute MCP server path so the entry does not depend on the shell working directory.

## Claude Code

Claude Code can use the same MCP server. Configure this only from the Claude environment you intend to modify:

```bash
claude mcp add mission-control \
  --env MC_URL="$MC_URL" \
  --env MC_API_KEY="$MC_API_KEY" \
  -- node /absolute/path/to/mission-control/scripts/mc-mcp-server.cjs
```

Verify from that same Claude environment:

```bash
claude mcp list
```

Do not edit another user's Claude configuration as part of Mission Control setup. Treat Claude MCP setup as an operator-owned step unless the operator explicitly asks you to change it.

## Hermes And Local Agents

Agents that do not support MCP can use the first-party CLI or direct REST calls.

Register a connection:

```bash
node scripts/mc-cli.cjs connect register \
  --tool-name hermes \
  --agent-name hermes-local \
  --body '{"agent_role":"assistant"}' \
  --json
```

Poll for work:

```bash
node scripts/mc-cli.cjs tasks queue \
  --agent hermes-local \
  --max-capacity 1 \
  --json
```

Send a heartbeat:

```bash
node scripts/mc-cli.cjs agents heartbeat --id <agent-id> --json
```

For custom agents, use the same flow with a stable `agent_name` and runtime-specific `tool_name`.

## Coordination Workflow

1. Create or assign a task:

```bash
node scripts/mc-cli.cjs tasks create \
  --title "Investigate failing smoke test" \
  --body '{"priority":"medium","assigned_to":"codex"}' \
  --json
```

2. Agent polls the queue:

```bash
node scripts/mc-cli.cjs tasks queue --agent codex --max-capacity 1 --json
```

3. Agent writes handoff context as a task comment:

```bash
node scripts/mc-cli.cjs tasks comments add \
  --id <task-id> \
  --content "Status: reproduced. Blocker: missing local service on port 3002." \
  --json
```

4. Another agent reads comments before continuing:

```bash
node scripts/mc-cli.cjs tasks comments list --id <task-id> --json
```

5. Agent updates task state:

```bash
node scripts/mc-cli.cjs tasks update \
  --id <task-id> \
  --body '{"status":"review"}' \
  --json
```

## Shared Message Feed

The agent comms endpoint provides a lightweight shared feed:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_API_KEY" \
  "$MC_URL/api/agents/comms?limit=20"
```

Use this for coordination broadcasts and readiness checks. Use task comments for durable task-specific handoffs.

## Smoke Test

With Mission Control running, verify the API path:

```bash
curl -fsS "$MC_URL/api/status?action=health"
curl -fsS -H "Authorization: Bearer $MC_API_KEY" "$MC_URL/api/agents/comms?limit=5"
```

Verify MCP protocol startup:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | MC_URL="$MC_URL" MC_API_KEY="$MC_API_KEY" node scripts/mc-mcp-server.cjs
```

For one-shot MCP tool-call smoke tests, use `playwright.mcp.config.ts`:

```bash
./node_modules/.bin/playwright test -c playwright.mcp.config.ts -g "waits for pending tool responses|initialize returns|tools/list"
```

