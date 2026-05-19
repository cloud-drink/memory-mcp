import { db } from "../db.js";
import fs from "fs";
const DEBUG_LOG = "C:\\Users\\Administrator\\.claude\\plugins\\marketplaces\\local-dev\\memory-mcp\\debug.log";
function logDebug(message) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG, `[${timestamp}] ${message}\n`);
}
function extractKeywords(texts, limit) {
    const stopWords = new Set([
        "the", "and", "for", "with", "that", "this", "from", "have", "you", "your",
        "我", "你", "他", "她", "它", "我们", "你们", "他们", "这个", "那个", "现在",
        "可以", "一下", "一个", "就是", "不是", "什么", "怎么", "请你", "帮我", "进行",
    ]);
    const counts = new Map();
    const combined = texts.join(" ").toLowerCase();
    const matches = combined.match(/[a-z0-9_./:-]{3,}|[\u4e00-\u9fa5]{2,}/g) || [];
    for (const rawToken of matches) {
        const token = rawToken.replace(/^[./:-]+|[./:-]+$/g, "");
        if (!token || stopWords.has(token) || token.length > 40)
            continue;
        counts.set(token, (counts.get(token) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([token]) => token);
}
function summarizeRoles(turns) {
    const userTurns = turns.filter((turn) => turn.role === "user").length;
    const assistantTurns = turns.filter((turn) => turn.role === "assistant").length;
    const lines = [
        `- User messages: ${userTurns}`,
        `- Assistant messages: ${assistantTurns}`,
    ];
    const userKeywords = extractKeywords(turns.filter((turn) => turn.role === "user").map((turn) => turn.content), 12);
    const assistantKeywords = extractKeywords(turns.filter((turn) => turn.role === "assistant").map((turn) => turn.content), 12);
    if (userKeywords.length > 0) {
        lines.push(`- Main user intent keywords: ${userKeywords.join(", ")}`);
    }
    if (assistantKeywords.length > 0) {
        lines.push(`- Main assistant response keywords: ${assistantKeywords.join(", ")}`);
    }
    return lines;
}
function summarizeActivities(activities) {
    const toolCounts = new Map();
    const fileTokens = [];
    for (const activity of activities) {
        const current = toolCounts.get(activity.tool_name) || { total: 0, failed: 0 };
        current.total++;
        if (!activity.is_success)
            current.failed++;
        toolCounts.set(activity.tool_name, current);
        if (activity.files_accessed) {
            fileTokens.push(activity.files_accessed);
        }
    }
    const lines = [...toolCounts.entries()]
        .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
        .map(([tool, count]) => `- ${tool}: ${count.total} call(s), ${count.failed} failed`);
    const fileKeywords = extractKeywords(fileTokens, 12);
    if (fileKeywords.length > 0) {
        lines.push(`- Referenced file/path keywords: ${fileKeywords.join(", ")}`);
    }
    return lines;
}
function buildAutoSummary(sessionId) {
    const turns = db.getUnfinalizedTurns(sessionId);
    const activities = db.getUnfinalizedActivities(sessionId);
    if (turns.length === 0 && activities.length === 0) {
        return null;
    }
    const projectId = turns[0]?.project_id ||
        activities[0]?.project_id ||
        "unknown";
    const lines = [
        `Auto-summary for session ${sessionId}`,
        `Project: ${projectId}`,
        `Conversation turns: ${turns.length}`,
        `Tool activities: ${activities.length}`,
    ];
    if (turns.length > 0) {
        lines.push("", "Extracted conversation summary:");
        lines.push(...summarizeRoles(turns));
    }
    if (activities.length > 0) {
        lines.push("", "Tool activity summary:");
        lines.push(...summarizeActivities(activities));
    }
    return {
        projectId,
        summary: lines.join("\n"),
    };
}
function saveAutoSummary(sessionId, reason) {
    const result = buildAutoSummary(sessionId);
    if (!result) {
        logDebug(`${reason} - No unfinalized data for session ${sessionId}`);
        return false;
    }
    const id = db.addMemory(result.projectId, result.summary, "auto-summary", sessionId);
    logDebug(`${reason} - Saved auto-summary ${id} for session ${sessionId}`);
    return true;
}
async function readStdin() {
    return new Promise((resolve) => {
        let data = "";
        process.stdin.on("data", (chunk) => {
            data += chunk;
        });
        process.stdin.on("end", () => {
            resolve(data);
        });
    });
}
async function main() {
    const event = process.argv[2];
    if (!event) {
        process.exit(0);
    }
    const rawInput = await readStdin();
    logDebug(`--- New Event: ${event} ---`);
    logDebug(`Input JSON: ${rawInput}`);
    let input = {};
    try {
        input = JSON.parse(rawInput);
    }
    catch (e) {
        // ignore
    }
    const sessionId = input.session_id || "default";
    const projectId = input.cwd || input.project_dir || input.working_dir || process.cwd();
    logDebug(`Parsed Context - Session: ${sessionId}, Project: ${projectId}`);
    switch (event) {
        case "PostToolUse":
            if (input.tool_name && input.tool_input) {
                let summary = "No output";
                let is_success = 1;
                if (input.tool_response) {
                    if (typeof input.tool_response === 'string') {
                        summary = input.tool_response.length > 100000 ? input.tool_response.substring(0, 100000) + "..." : input.tool_response;
                    }
                    else if (input.tool_response.stdout !== undefined || input.tool_response.stderr !== undefined) {
                        summary = input.tool_response.stdout || input.tool_response.stderr || "Success (no output)";
                        if (input.tool_response.exit_code !== undefined && input.tool_response.exit_code !== 0) {
                            is_success = 0;
                        }
                    }
                    else if (input.tool_response.content) {
                        summary = typeof input.tool_response.content === 'string'
                            ? (input.tool_response.content.length > 100000 ? input.tool_response.content.substring(0, 100000) + "..." : input.tool_response.content)
                            : JSON.stringify(input.tool_response.content).substring(0, 100000);
                    }
                    else {
                        summary = JSON.stringify(input.tool_response).substring(0, 100000);
                    }
                    if (input.tool_response.is_error)
                        is_success = 0;
                }
                db.recordActivity({
                    project_id: projectId,
                    session_id: sessionId,
                    tool_name: input.tool_name,
                    arguments: JSON.stringify(input.tool_input),
                    result_summary: summary,
                    is_success: is_success
                });
            }
            console.log(JSON.stringify({ continue: true, suppressOutput: true }));
            break;
        case "SessionStart": {
            let summarizedCount = 0;
            for (const pid of db.getAllProjectIds()) {
                for (const sid of db.getUnfinalizedSessions(pid)) {
                    if (sid !== sessionId && saveAutoSummary(sid, "SessionStart")) {
                        summarizedCount++;
                    }
                }
            }
            if (summarizedCount > 0) {
                console.log(JSON.stringify({
                    continue: true,
                    systemMessage: `[MEMORY-MCP] Saved ${summarizedCount} previous session summary record(s) to long-term memory.`
                }));
            }
            else {
                console.log(JSON.stringify({ continue: true, suppressOutput: true }));
            }
            break;
        }
        case "UserPromptSubmit":
            if (input.prompt) {
                db.addTurn(projectId, sessionId, "user", input.prompt);
            }
            console.log(JSON.stringify({ continue: true, suppressOutput: true }));
            break;
        case "Stop":
            if (input.last_assistant_message) {
                db.addTurn(projectId, sessionId, "assistant", input.last_assistant_message);
            }
            console.log(JSON.stringify({ continue: true, suppressOutput: true }));
            break;
        case "PreCompact": {
            const saved = saveAutoSummary(sessionId, "PreCompact");
            if (saved) {
                console.log(JSON.stringify({
                    continue: true,
                    systemMessage: `[MEMORY-MCP] Context compaction detected. Current session was summarized and saved to long-term memory.`
                }));
            }
            else {
                console.log(JSON.stringify({ continue: true, suppressOutput: true }));
            }
            break;
        }
        default:
            console.log(JSON.stringify({ continue: true }));
    }
}
main().catch((err) => {
    logDebug(`Fatal Error: ${err}`);
    process.exit(0);
});
