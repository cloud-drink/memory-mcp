import { db } from "../db.js";
import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ID = "memory-mcp-plugin@local-dev";
const MCP_SERVER_NAME = "memory-mcp";

function readJsonFile(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getClaudeSettings(): any | null {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return null;
  return readJsonFile(path.join(home, ".claude", "settings.json"));
}

function isMemoryMcpEnabled(): boolean {
  if (process.env.MEMORY_MCP_HOOKS_DISABLED === "1") {
    return false;
  }

  const settings = getClaudeSettings();
  if (!settings) {
    return true;
  }

  const pluginEnabled = settings.enabledPlugins?.[PLUGIN_ID];
  if (settings.enabledPlugins && pluginEnabled !== true) {
    return false;
  }

  const serverConfig = settings.mcpServers?.[MCP_SERVER_NAME];
  if (serverConfig === false || serverConfig?.disabled === true || serverConfig?.enabled === false) {
    return false;
  }

  return true;
}

function startSummaryWorker() {
  const workerPath = path.join(__dirname, "..", "summary-worker.js");
  const child = spawn("node", [workerPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function enqueueSummaryJob(sessionId: string, projectId: string, reason: string): string | null {
  const detectedProjectId = db.getUnfinalizedSessionProject(sessionId) || projectId;
  const hasTurns = db.getUnfinalizedTurns(sessionId).length > 0;
  const hasActivities = db.getUnfinalizedActivities(sessionId).length > 0;

  if (!hasTurns && !hasActivities) {
    return null;
  }

  const jobId = db.createSummaryJob(detectedProjectId, sessionId, reason);
  startSummaryWorker();
  return jobId;
}

async function readStdin(): Promise<string> {
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

  if (!isMemoryMcpEnabled()) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  let input: any = {};
  try {
    input = JSON.parse(rawInput);
  } catch (e) {
    // ignore
  }

  const sessionId = input.session_id || "default";
  const projectId = input.cwd || input.project_dir || input.working_dir || process.cwd();

  switch (event) {

    case "PostToolUse":
      if (input.tool_name && input.tool_input) {
        let summary = "No output";
        let is_success = 1;

        if (input.tool_response) {
          if (typeof input.tool_response === 'string') {
            summary = input.tool_response.length > 100000 ? input.tool_response.substring(0, 100000) + "..." : input.tool_response;
          } else if (input.tool_response.stdout !== undefined || input.tool_response.stderr !== undefined) {
            summary = input.tool_response.stdout || input.tool_response.stderr || "Success (no output)";
            if (input.tool_response.exit_code !== undefined && input.tool_response.exit_code !== 0) {
              is_success = 0;
            }
          } else if (input.tool_response.content) {
            summary = typeof input.tool_response.content === 'string' 
              ? (input.tool_response.content.length > 100000 ? input.tool_response.content.substring(0, 100000) + "..." : input.tool_response.content)
              : JSON.stringify(input.tool_response.content).substring(0, 100000);
          } else {
            summary = JSON.stringify(input.tool_response).substring(0, 100000);
          }

          if (input.tool_response.is_error) is_success = 0;
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
      let queuedCount = 0;

      for (const pid of db.getAllProjectIds()) {
        for (const sid of db.getUnfinalizedSessions(pid)) {
          if (sid !== sessionId && enqueueSummaryJob(sid, pid, "SessionStart")) {
            queuedCount++;
          }
        }
      }

      if (queuedCount > 0) {
        console.log(JSON.stringify({
          continue: true,
          systemMessage: `[MEMORY-MCP] Queued ${queuedCount} previous session(s) for background summarization.`
        }));
      } else {
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
      const jobId = enqueueSummaryJob(sessionId, projectId, "PreCompact");
      if (jobId) {
        console.log(JSON.stringify({
          continue: true,
          systemMessage: `[MEMORY-MCP] Context compaction detected. Current session was queued for background summarization.`
        }));
      } else {
        console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      }
      break;
    }

    default:
      console.log(JSON.stringify({ continue: true }));
  }
}

main().catch((err) => {
  process.exit(0);
});
