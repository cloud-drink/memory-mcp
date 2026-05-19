---
description: Summarize the current session and save to long-term memory.
---

# Summarize Session
1. Call the `summarize_current_session` tool to get instructions and session ID.
2. Call `finalize_session` with the session ID to retrieve raw data.
3. Analyze the raw data and generate a **highly concise** summary of technical outcomes and key decisions.
4. Call the `remember_conversation` tool with the current project ID and the generated summary.
5. Confirm the successful storage to the user.
