# Memory-MCP

Cross-session long-term memory, conversation summarization, and tool activity audit for Claude Code style agents.

Memory-MCP records raw conversation turns and tool activity during a session, queues background summary jobs when a session starts or context is compacted, summarizes the useful project context, and stores it in a searchable SQLite memory database.

## Features

- MCP memory tools for saving, searching, deleting, and recalling memories.
- Claude Code hooks for automatic raw turn and tool activity logging.
- Background summary queue powered by DeepSeek API, with local fallback summarization.
- Web viewer for browsing and deleting memories, conversations, and activity logs.
- `/memo`, `/summarize`, and `/viewer` command prompts.
- SQLite + FTS5 full-text search.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Build the project:

```bash
npm run build
```

3. Configure DeepSeek summarization:

Edit:

```text
plugin/deepseek.config.json
```

Set your API key:

```json
{
  "apiKey": "YOUR_DEEPSEEK_API_KEY",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "thinking": "disabled"
}
```

4. Install or mount the plugin in Claude Code.

The plugin folder contains:

```text
plugin/.claude-plugin
plugin/.mcp.json
plugin/hooks.json
plugin/deepseek.config.json
plugin/package.json
```

5. Restart Claude Code.

After restart, Memory-MCP should:

- start the MCP server from `dist/index.js`
- register hooks from `plugin/hooks.json`
- automatically log turns and tool calls
- queue background summaries on `SessionStart` and `PreCompact`
- write long-term memories to `memory.db`

## Personal Install Flow

This is the recommended personal setup if you want to use the project as a local Claude Code marketplace plugin.

1. Copy the whole `memory-mcp` project into Claude's local marketplace directory.

Example:

```text
C:/Users/Administrator/.claude/plugins/marketplaces/local-dev/memory-mcp
```

2. Load the whole project as a local marketplace/store plugin.

The plugin metadata lives in:

```text
plugin/.claude-plugin
plugin/package.json
plugin/.mcp.json
plugin/hooks.json
```

3. Copy command prompt files into your global Claude commands directory.

Source:

```text
memory-mcp/.claude/commands
```

Destination:

```text
C:/Users/Administrator/.claude/commands
```

If the global `commands` directory does not exist, create it first.

4. Mount hooks in your global Claude settings file.

Edit:

```text
C:/Users/Administrator/.claude/settings.json
```

Add or merge the following `hooks` block. Replace the path if your project is installed somewhere else.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "command": "node \"C:/Users/Administrator/.claude/plugins/marketplaces/local-dev/memory-mcp/dist/hooks/handler.js\" PostToolUse",
            "shell": "bash",
            "timeout": 10,
            "type": "command"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "command": "node \"C:/Users/Administrator/.claude/plugins/marketplaces/local-dev/memory-mcp/dist/hooks/handler.js\" PreCompact",
            "shell": "bash",
            "timeout": 10,
            "type": "command"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "command": "node \"C:/Users/Administrator/.claude/plugins/marketplaces/local-dev/memory-mcp/dist/hooks/handler.js\" SessionStart",
            "shell": "bash",
            "timeout": 10,
            "type": "command"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "command": "node \"C:/Users/Administrator/.claude/plugins/marketplaces/local-dev/memory-mcp/dist/hooks/handler.js\" Stop",
            "shell": "bash",
            "timeout": 10,
            "type": "command"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "command": "node \"C:/Users/Administrator/.claude/plugins/marketplaces/local-dev/memory-mcp/dist/hooks/handler.js\" UserPromptSubmit",
            "shell": "bash",
            "timeout": 10,
            "type": "command"
          }
        ]
      }
    ]
  }
}
```

If your `settings.json` already has a `hooks` object, merge these events into the existing object instead of replacing unrelated hooks.

5. Restart Claude Code.

## MCP Mount

The MCP server is mounted through:

```text
plugin/.mcp.json
```

Example:

```json
{
  "memory-mcp": {
    "command": "node",
    "args": ["C:\\path\\to\\memory-mcp\\dist\\index.js"]
  }
}
```

For publishing or installing on another machine, update `args[0]` to the absolute path of your built `dist/index.js`.

The MCP server exposes these tools:

- `remember`: save a memory for the current project or globally.
- `add_memory`: quickly save a manual fact.
- `search_memory`: search memories within one project, including global memories.
- `search_all_projects`: search memories across all projects.
- `delete_memory`: delete one memory by ID.
- `remember_conversation`: save a concise conversation summary.
- `log_turn`: log one raw conversation turn.
- `record_activity`: log a tool execution event.
- `query_activity`: read recent activity logs.
- `summarize_current_session`: retrieve unfinalized raw data for manual summarization.
- `finalize_session`: legacy/manual finalization flow.
- `open_memory_viewer`: start the local web viewer.

## Hook Mount

Hooks are mounted through:

```text
plugin/hooks.json
```

Current hook events:

```json
{
  "SessionStart": "node \"$PLUGIN_ROOT/../dist/hooks/handler.js\" SessionStart",
  "UserPromptSubmit": "node \"$PLUGIN_ROOT/../dist/hooks/handler.js\" UserPromptSubmit",
  "Stop": "node \"$PLUGIN_ROOT/../dist/hooks/handler.js\" Stop",
  "PostToolUse": "node \"$PLUGIN_ROOT/../dist/hooks/handler.js\" PostToolUse",
  "PreCompact": "node \"$PLUGIN_ROOT/../dist/hooks/handler.js\" PreCompact"
}
```

What each hook does:

- `UserPromptSubmit`: stores the user's raw prompt in `raw_turns`.
- `Stop`: stores the assistant's last message in `raw_turns`.
- `PostToolUse`: stores tool execution metadata in `activity_logs`.
- `PreCompact`: queues the current session for background summarization.
- `SessionStart`: queues previous unfinalized sessions for background summarization.

The hook handler starts:

```text
dist/summary-worker.js
```

as a detached background worker when a summary job is queued.

## Commands

Command prompts live in:

```text
.claude/commands
```

### `/memo`

Recall existing memories from the database and add selected memory context to the current conversation.

Behavior:

- With a query, `/memo some topic` searches for matching memories.
- Without a query, `/memo` lists available projects/recent memories and asks what to recall.
- It should not save new memories.

### `/summarize`

Manually summarize the current session and save the concise result to long-term memory.

This is mostly a manual fallback. The preferred flow is automatic background summarization through hooks and `summary_jobs`.

### `/viewer`

Start the web viewer and open:

```text
http://localhost:3000
```

## Web Viewer

Start manually:

```bash
npm run viewer
```

Or use:

```text
/viewer
```

The viewer supports:

- browsing memories grouped by project
- browsing raw conversations
- browsing activity logs
- deleting individual records
- deleting all records for a project within one category

Project deletion is category-specific. Deleting a project from `memories` does not delete the same project from `turns` or `activities`.

## Background Summarization

The summary flow is queue-based:

```text
hooks
  -> summary_jobs
  -> summary-worker
  -> DeepSeek API or local fallback
  -> memories_content
  -> mark raw_turns/activity_logs finalized
```

The worker uses this priority:

```text
MEMORY_MCP_SUMMARIZER_COMMAND
  -> plugin/deepseek.config.json
  -> environment variable fallback
  -> local keyword/statistics fallback
```

### DeepSeek Config

Primary config file:

```text
plugin/deepseek.config.json
```

Fields:

- `apiKey`: DeepSeek API key.
- `baseUrl`: defaults to `https://api.deepseek.com`.
- `model`: defaults to `deepseek-v4-flash`; can be `deepseek-v4-pro`.
- `thinking`: defaults to `disabled`; can be `enabled`.

If DeepSeek fails or no key is configured, the worker stores a local fallback summary instead of blocking the hook.

### External Summarizer Command

For custom summarization, set:

```bash
MEMORY_MCP_SUMMARIZER_COMMAND="your command"
```

The command receives a JSON payload on stdin and must write the final summary to stdout.

This command takes priority over DeepSeek.

## Database

Memory-MCP stores data in:

```text
memory.db
```

Main tables:

- `memories_content`: long-term memory records.
- `memories_fts`: FTS5 search index for memory content.
- `raw_turns`: raw user/assistant turns before summarization.
- `activity_logs`: tool execution audit records.
- `summary_jobs`: queued background summarization jobs.

FTS5 also creates internal shadow tables such as:

- `memories_fts_content`
- `memories_fts_data`
- `memories_fts_idx`
- `memories_fts_docsize`
- `memories_fts_config`

Do not edit the FTS shadow tables manually.

## Development

Build:

```bash
npm run build
```

Start MCP server:

```bash
npm run start
```

Run one summary worker pass:

```bash
npm run summary-worker
```

Start viewer:

```bash
npm run viewer
```

## Notes

- This project is ESM-only (`"type": "module"`). Generated files in `dist` must stay ESM.
- If hooks fail with `exports is not defined`, the build output was generated as CommonJS and must be rebuilt as ESM.
- `plugin/memory.db` is not the primary runtime database. The main database is `memory.db` at the project root.
- Do not store raw chat logs as long-term memories. Automatic summaries should keep only durable facts, decisions, outcomes, unresolved tasks, and important implementation context.
