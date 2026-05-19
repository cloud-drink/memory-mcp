# Memory-MCP: Tiered Long-Term Memory & Audit Server

## 1. Objective
To build a Model Context Protocol (MCP) server that implements a **Layered Memory Architecture**:
- **Layer 1: Raw Interaction Logging**: Save every conversation turn and `agentfs` operation in its original form during the session to save tokens and maintain fidelity.
- **Layer 2: Deferred Summarization**: Automatically compress a full session's raw logs into a compact "Long-Term Memory" entry only when the session ends.
- **Layer 3: JIT (Just-In-Time) Summarization**: If a session hasn't been summarized yet but its content is relevant to a query, perform an on-the-fly summary before injecting it into context.

## 2. Technology Stack
- **Language**: TypeScript (Node.js)
- **Framework**: `@modelcontextprotocol/sdk`
- **Storage**: `better-sqlite3` (with **FTS5**).

## 3. Database Schema (SQLite)

### Table: `memories` (FTS5)
Compressed high-level facts and finalized session summaries.
- `id`: TEXT (UUID)
- `project_id`: TEXT
- `content`: TEXT (Summarized content)
- `type`: TEXT (`manual_fact`, `session_summary`)
- `created_at`: DATETIME

### Table: `raw_turns`
Temporary storage for turn-by-turn conversation.
- `id`: TEXT (UUID)
- `project_id`: TEXT
- `session_id`: TEXT
- `role`: TEXT (`user`, `assistant`)
- `content`: TEXT (Full raw text)
- `timestamp`: DATETIME

### Table: `activity_logs`
Low-level execution traces (tools, files, results).
- `id`: TEXT (UUID)
- `project_id`: TEXT
- `session_id`: TEXT
- `tool_name`: TEXT
- `arguments`: TEXT
- `result_summary`: TEXT
- `timestamp`: DATETIME

## 4. MCP Tools

### Interaction Tools (Turn-based)
1. **`log_turn`**: Save raw user/assistant text for the current session.
2. **`record_activity`**: Log execution details.

### Finalization Tools (Session-end)
3. **`finalize_session`**: Aggregate all `raw_turns` and `activity_logs` for a session, generate a summary, save to `memories`, and mark logs as processed.

### Retrieval Tools
4. **`search_memory`**: 
   - Search `memories`.
   - **Fallback**: If relevant raw data is found in un-finalized sessions, perform JIT summarization.
5. **`query_activity`**: Audit recent actions.

## 5. Implementation Roadmap
1. **Phase 1**: Update DB schema with `raw_turns` and processing flags.
2. **Phase 2**: Implement `log_turn` and `finalize_session` logic.
3. **Phase 3**: Implement the JIT summarization logic in the search tool.
4. **Phase 4**: Setup Claude Code hooks to automate session finalization.


