#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { db } from "./db.js";
import { exec, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Utility to redirect console.log to stderr to protect the MCP stdio channel
const originalLog = console.log;
console.log = (...args) => {
    console.error(...args);
};
const server = new Server({
    name: "memory-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
/**
 * Tool Definitions
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "remember",
                description: "Save a specific fact or conversation snippet to the project's long-term memory.",
                inputSchema: {
                    type: "object",
                    properties: {
                        content: { type: "string", description: "The memory payload" },
                        project_id: { type: "string", description: "Identifier for the current project" },
                        is_global: { type: "boolean", description: "Whether this memory is global across projects" }
                    },
                    required: ["content", "project_id"]
                },
            },
            {
                name: "search_memory",
                description: "Search past memories using keywords scoped by project.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search query" },
                        project_id: { type: "string", description: "Identifier for the current project" },
                        limit: { type: "number", description: "Max results (default 10)" }
                    },
                    required: ["query", "project_id"]
                },
            },
            {
                name: "search_all_projects",
                description: "Search across ALL projects for a specific keyword.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search query" },
                        limit: { type: "number", description: "Max results (default 10)" }
                    },
                    required: ["query"]
                },
            },
            {
                name: "delete_memory",
                description: "Manually delete a memory by its ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        memory_id: { type: "string", description: "The UUID of the memory to delete" }
                    },
                    required: ["memory_id"]
                },
            },
            {
                name: "remember_conversation",
                description: "Store a highly concise summary of the current session or a specific topic. DO NOT store raw logs or turn-by-turn conversations. Extract and store only key decisions, technical outcomes, and essential progress. Keep it as short as possible.",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { type: "string", description: "Current project ID" },
                        summary: { type: "string", description: "The concise, high-level summary" },
                        session_id: { type: "string", description: "Optional session ID to mark as finalized" }
                    },
                    required: ["project_id", "summary"]
                },
            },
            {
                name: "log_turn",
                description: "Log a raw conversation turn (user or assistant) for later summarization.",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { type: "string", description: "Current project ID" },
                        session_id: { type: "string", description: "Unique session identifier" },
                        role: { type: "string", enum: ["user", "assistant"], description: "Role of the speaker" },
                        content: { type: "string", description: "Raw text of the turn" }
                    },
                    required: ["project_id", "session_id", "role", "content"]
                },
            },
            {
                name: "finalize_session",
                description: "Finalize a session by aggregating logs and turns for the agent to summarize. Returns all unfinalized data.",
                inputSchema: {
                    type: "object",
                    properties: {
                        session_id: { type: "string", description: "Unique session identifier" }
                    },
                    required: ["session_id"]
                },
            },
            {
                name: "record_activity",
                description: "Log a tool execution event for auditing and tracing (agentfs operations).",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { type: "string", description: "Current project ID" },
                        tool_name: { type: "string", description: "Name of the tool executed" },
                        arguments: { type: "string", description: "JSON string of input parameters" },
                        files_accessed: { type: "string", description: "Comma-separated paths or JSON list" },
                        result_summary: { type: "string", description: "Summary of the outcome" },
                        is_success: { type: "boolean", description: "Whether the execution was successful" }
                    },
                    required: ["project_id", "tool_name", "arguments", "result_summary", "is_success"]
                },
            },
            {
                name: "query_activity",
                description: "Retrieve past agent activities for a project.",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { type: "string", description: "Current project ID" },
                        limit: { type: "number", description: "Max results (default 20)" }
                    },
                    required: ["project_id"]
                },
            },
            {
                name: "open_memory_viewer",
                description: "Start the Memory-MCP web viewer and open it in the browser.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                },
            },
            {
                name: "summarize_current_session",
                description: "Manually trigger a concise AI-driven summary of the current session's progress.",
                inputSchema: {
                    type: "object",
                    properties: {
                        session_id: { type: "string", description: "The session ID to summarize (optional, defaults to current)" }
                    },
                    required: []
                },
            },
            {
                name: "add_memory",
                description: "Quickly save an important fact or technical detail to the current project's long-term memory.",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { type: "string", description: "Project path" },
                        content: { type: "string", description: "The detail to remember" }
                    },
                    required: ["project_id", "content"]
                },
            }
        ],
    };
});
/**
 * Tool Handlers
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "open_memory_viewer": {
                const viewerPath = path.join(__dirname, 'viewer.js');
                // Start the viewer in a detached process
                const child = spawn('node', [viewerPath], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
                // Wait a bit for server to start then open browser (Windows specific)
                setTimeout(() => {
                    exec('start http://localhost:3000');
                }, 2000);
                return {
                    content: [{ type: "text", text: "Memory viewer started at http://localhost:3000 and opening browser..." }],
                };
            }
            case "summarize_current_session": {
                const { session_id } = z.object({
                    session_id: z.string().optional()
                }).parse(args);
                const sid = session_id || "current";
                const turns = db.getUnfinalizedTurns(sid);
                const activities = db.getUnfinalizedActivities(sid);
                if (turns.length === 0 && activities.length === 0) {
                    return {
                        content: [{ type: "text", text: `No unfinalized data found for session ${sid}.` }],
                    };
                }
                const dataToSummarize = {
                    session_id: sid,
                    conversation_history: turns.map(t => `[${t.role}]: ${t.content}`),
                    activity_history: activities.map(a => `- ${a.tool_name}: ${a.result_summary}`)
                };
                return {
                    content: [{
                            type: "text",
                            text: `RAW DATA for session ${sid} retrieved. Please analyze this and call 'remember_conversation' with a concise summary and 'session_id' set to '${sid}'.\n\n` + JSON.stringify(dataToSummarize, null, 2)
                        }],
                };
            }
            case "add_memory": {
                const { project_id, content } = z.object({
                    project_id: z.string(),
                    content: z.string()
                }).parse(args);
                const id = db.addMemory(project_id, content, "manual");
                return {
                    content: [{ type: "text", text: `Fact saved to long-term memory with ID: ${id}` }],
                };
            }
            case "remember": {
                const { content, project_id, is_global } = z.object({
                    content: z.string(),
                    project_id: z.string(),
                    is_global: z.boolean().optional()
                }).parse(args);
                const targetId = is_global ? "global" : project_id;
                const id = db.addMemory(targetId, content);
                return {
                    content: [{ type: "text", text: `Memory saved with ID: ${id}` }],
                };
            }
            case "search_memory": {
                const { query, project_id, limit } = z.object({
                    query: z.string(),
                    project_id: z.string(),
                    limit: z.number().optional()
                }).parse(args);
                const results = db.searchMemory(project_id, query, limit);
                return {
                    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                };
            }
            case "search_all_projects": {
                const { query, limit } = z.object({
                    query: z.string(),
                    limit: z.number().optional()
                }).parse(args);
                const results = db.searchAllProjects(query, limit);
                return {
                    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                };
            }
            case "delete_memory": {
                const { memory_id } = z.object({
                    memory_id: z.string()
                }).parse(args);
                const success = db.deleteMemory(memory_id);
                return {
                    content: [{ type: "text", text: success ? `Memory ${memory_id} deleted successfully.` : `Memory ${memory_id} not found.` }],
                };
            }
            case "remember_conversation": {
                const { project_id, summary, session_id } = z.object({
                    project_id: z.string(),
                    summary: z.string(),
                    session_id: z.string().optional()
                }).parse(args);
                const id = db.addMemory(project_id, summary, "conversation", session_id);
                return {
                    content: [{ type: "text", text: `Conversation context saved with ID: ${id}` }],
                };
            }
            case "log_turn": {
                const { project_id, session_id, role, content } = z.object({
                    project_id: z.string(),
                    session_id: z.string(),
                    role: z.string(),
                    content: z.string()
                }).parse(args);
                const id = db.addTurn(project_id, session_id, role, content);
                return {
                    content: [{ type: "text", text: `Turn logged with ID: ${id}` }],
                };
            }
            case "finalize_session": {
                const { session_id } = z.object({
                    session_id: z.string()
                }).parse(args);
                const turns = db.getUnfinalizedTurns(session_id);
                const activities = db.getUnfinalizedActivities(session_id);
                if (turns.length === 0 && activities.length === 0) {
                    return {
                        content: [{ type: "text", text: "No unfinalized data found for this session." }],
                    };
                }
                // Return the data for the agent to summarize
                const dataToSummarize = {
                    conversation_history: turns.map(t => `[${t.role}]: ${t.content}`),
                    activity_history: activities.map(a => `- ${a.tool_name}: ${a.result_summary}`)
                };
                // Mark as finalized in DB
                db.markSessionAsFinalized(session_id);
                return {
                    content: [{
                            type: "text",
                            text: `Data for session ${session_id} retrieved. Please summarize this content and call 'remember_conversation' with the result.\n\n` + JSON.stringify(dataToSummarize, null, 2)
                        }],
                };
            }
            case "record_activity": {
                const validated = z.object({
                    project_id: z.string(),
                    tool_name: z.string(),
                    arguments: z.string(),
                    files_accessed: z.string().optional(),
                    result_summary: z.string(),
                    is_success: z.boolean()
                }).parse(args);
                const id = db.recordActivity({
                    ...validated,
                    is_success: validated.is_success ? 1 : 0
                });
                return {
                    content: [{ type: "text", text: `Activity logged with ID: ${id}` }],
                };
            }
            case "query_activity": {
                const { project_id, limit } = z.object({
                    project_id: z.string(),
                    limit: z.number().optional()
                }).parse(args);
                const results = db.queryActivity(project_id, limit);
                return {
                    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Memory-MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
