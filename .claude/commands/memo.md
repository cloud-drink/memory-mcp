---
description: Recall existing memories from the database and add them to the current conversation.
---

# Recall Memory to Conversation
`/memo` is reserved for recalling existing memories. Do not use it to save new memories.

1. If the user provides a search query after `/memo`, use it as the memory search query. Otherwise, call `search_all_projects` with an empty query to retrieve available projects and recent memories.
2. Present the available project IDs or likely matches concisely, then ask the user which project or memory they want to recall if the choice is ambiguous.
3. Once the project is known, call `search_memory` for that `project_id` using the provided query, or an empty/broad query if no query was provided.
4. Present the matching memories and ask which ones should be added to the current conversation context when there are multiple plausible matches.
5. Summarize the selected memory content into the active chat context. Do not paste raw logs unless the user explicitly asks for them.
