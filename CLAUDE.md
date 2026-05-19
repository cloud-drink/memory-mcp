# Claude Code Memory Plugin - Custom Instructions

## 🛠 Memory Management Commands

When the user gives the following commands, follow these specific instructions:

### 1. "Summarize this session" or "/summarize"
- **Action**: Call the `summarize_current_session` tool.
- **Instruction**: Once the tool returns raw data, analyze it and use the `remember_conversation` tool to store a **highly concise** summary. Focus on technical outcomes and key decisions. Do not include raw chat logs.

### 2. "Open memory viewer" or "/viewer"
- **Action**: Call the `open_memory_viewer` tool.
- **Instruction**: Confirm that the viewer has been started and provides the link `http://localhost:3000` to the user.

### 3. "Memorize [text]" or "/memo [text]"
- **Action**: Call the `add_memory` tool with the provided text.
- **Instruction**: Store the specific fact into the project's long-term memory. Confirm the successful storage to the user.

---

## 💡 Best Practices for Summarization
- Keep summaries **short but information-dense**.
- Use Markdown formatting (bullet points, bold text).
- Always include the **Project ID** when calling memory tools.
- Focus on "What was solved" and "What was decided".
