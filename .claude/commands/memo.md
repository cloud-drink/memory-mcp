---
description: Recall existing memories from the database and add them to the current conversation.
---

# Recall Memory to Conversation
1. Call the `search_all_projects` tool with an empty query to retrieve a list of all project IDs in the memory database.
2. Present the list of projects to the user and ask them to select the project they want to retrieve memories from.
3. Once the project is selected, call the `search_memory` tool for that `project_id` with an empty query (or a broad search) to list available memories and summaries.
4. Present the list of memories (summaries, facts, etc.) to the user and ask which specific ones they would like to "add" or "recall" into the current conversation context.
5. After the user selects the memories, summarize the selected information in the current chat to ensure it is part of the active context and explain how it relates to the current task.
