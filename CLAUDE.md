# Claude Code Memory Plugin - Custom Instructions

## 🛠 Memory Management Commands

When the user gives the following commands, follow these specific instructions:

### 1. "Summarize this session" or "/summarize"
- **Action**: Call the `summarize_current_session` tool.
- **Instruction**: Once the tool returns raw data, analyze it and use the `remember_conversation` tool to store a **highly concise** summary. Focus on technical outcomes and key decisions. Do not include raw chat logs.

### 2. "Open memory viewer" or "/viewer"
- **Action**: Call the `open_memory_viewer` tool.
- **Instruction**: Confirm that the viewer has been started and provides the link `http://localhost:3000` to the user.

### 3. "/memo"
- **Action**: Recall existing memories from the database.
- **Instruction**: Use `search_all_projects` to list available projects, ask the user which project to recall from, then use `search_memory` to retrieve relevant memories. Present concise options and add the selected memories into the active conversation context by summarizing them.

### 4. "Memorize [text]"
- **Action**: Call the `add_memory` tool with the provided text.
- **Instruction**: Store the specific fact into the project's long-term memory. Confirm the successful storage to the user. Do not use `/memo` for saving; `/memo` is reserved for recall.

---

## 💡 Best Practices for Summarization
- Keep summaries **short but information-dense**.
- Use Markdown formatting (bullet points, bold text).
- Always include the **Project ID** when calling memory tools.
- Focus on "What was solved" and "What was decided".

---

## 🤖 Background Summarization Provider

The background summary worker supports DeepSeek API summarization.

Primary config:
- `plugin/deepseek.config.json`: stores DeepSeek provider settings for this plugin.
- Set `apiKey` in that file to enable DeepSeek summarization.

Optional fields:
- `model`: defaults to `deepseek-v4-flash`; can be set to `deepseek-v4-pro`.
- `baseUrl`: defaults to `https://api.deepseek.com`.
- `thinking`: defaults to `disabled`; can be set to `enabled`.

Environment variable fallback:
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_THINKING`
- `MEMORY_MCP_SUMMARIZER_COMMAND`: if set, this external command takes priority over DeepSeek. It receives the session payload on stdin and must write the final summary to stdout.

If no model provider is configured, or if the provider fails, the worker falls back to a local keyword/statistics summary.
