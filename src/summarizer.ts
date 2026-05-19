import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DeepSeekConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  thinking?: "enabled" | "disabled";
}

interface SummaryPayload {
  session_id: string;
  project_id: string;
  instructions: string;
  conversation: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  activities: Array<{
    tool_name: string;
    arguments: string;
    files_accessed?: string;
    is_success: number;
    timestamp: string;
  }>;
}

function extractKeywords(texts: string[], limit: number): string[] {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "have", "you", "your",
    "我", "你", "他", "她", "它", "我们", "你们", "他们", "这个", "那个", "现在",
    "可以", "一下", "一个", "就是", "不是", "什么", "怎么", "请你", "帮我", "进行",
  ]);

  const counts = new Map<string, number>();
  const combined = texts.join(" ").toLowerCase();
  const matches = combined.match(/[a-z0-9_./:-]{3,}|[\u4e00-\u9fa5]{2,}/g) || [];

  for (const rawToken of matches) {
    const token = rawToken.replace(/^[./:-]+|[./:-]+$/g, "");
    if (!token || stopWords.has(token) || token.length > 40) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function buildPayload(sessionId: string, projectId: string): SummaryPayload | null {
  const turns = db.getUnfinalizedTurns(sessionId);
  const activities = db.getUnfinalizedActivities(sessionId);

  if (turns.length === 0 && activities.length === 0) {
    return null;
  }

  return {
    session_id: sessionId,
    project_id: projectId,
    instructions: [
      "Summarize this agent session for long-term project memory.",
      "Extract only durable facts, decisions, outcomes, unresolved tasks, and important implementation context.",
      "Do not quote or preserve original conversation text.",
      "Do not include private chatter, filler, or turn-by-turn logs.",
      "Keep the summary concise and information-dense.",
    ].join(" "),
    conversation: turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
      timestamp: turn.timestamp,
    })),
    activities: activities.map((activity) => ({
      tool_name: activity.tool_name,
      arguments: activity.arguments,
      files_accessed: activity.files_accessed,
      is_success: activity.is_success,
      timestamp: activity.timestamp,
    })),
  };
}

function buildModelPrompt(payload: SummaryPayload): string {
  return [
    "请把下面这段 agent 会话压缩为长期项目记忆。",
    "",
    "要求：",
    "- 只提炼可长期复用的事实、决策、技术结论、完成事项、未完成事项、重要文件/模块上下文。",
    "- 不要复述原始对话，不要逐轮记录，不要引用用户或助手原话。",
    "- 过滤寒暄、情绪表达、重复确认和临时过程。",
    "- 如果工具活动里出现文件、模块、错误、命令结果，只保留对后续开发有用的结论。",
    "- 输出中文 Markdown，尽量短，信息密度高。",
    "- 如果没有值得长期保存的信息，输出：无重要长期记忆。",
    "",
    "会话 JSON：",
    JSON.stringify(payload),
  ].join("\n");
}

function readDeepSeekConfig(): DeepSeekConfig {
  const configPaths = [
    path.join(__dirname, "..", "plugin", "deepseek.config.json"),
    path.join(__dirname, "..", "deepseek.config.json"),
  ];

  for (const configPath of configPaths) {
    if (!fs.existsSync(configPath)) continue;

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as DeepSeekConfig;
    return config;
  }

  return {};
}

async function runDeepSeekSummarizer(payload: SummaryPayload): Promise<string> {
  const config = readDeepSeekConfig();
  const apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  const baseUrl = (config.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = config.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const thinkingType = config.thinking || process.env.DEEPSEEK_THINKING || "disabled";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "你是一个长期记忆压缩器。你的任务是把 agent 会话提炼为简短、可靠、可复用的项目记忆，禁止保留原始聊天记录。",
        },
        {
          role: "user",
          content: buildModelPrompt(payload),
        },
      ],
      thinking: { type: thinkingType },
      stream: false,
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek API returned an empty summary");
  }

  return content;
}

function buildFallbackSummary(payload: SummaryPayload): string {
  const userTurns = payload.conversation.filter((turn) => turn.role === "user");
  const assistantTurns = payload.conversation.filter((turn) => turn.role === "assistant");
  const toolCounts = new Map<string, { total: number; failed: number }>();
  const fileTokens: string[] = [];

  for (const activity of payload.activities) {
    const current = toolCounts.get(activity.tool_name) || { total: 0, failed: 0 };
    current.total++;
    if (!activity.is_success) current.failed++;
    toolCounts.set(activity.tool_name, current);
    if (activity.files_accessed) fileTokens.push(activity.files_accessed);
  }

  const lines = [
    `Auto-summary for session ${payload.session_id}`,
    `Project: ${payload.project_id}`,
    `Conversation turns: ${payload.conversation.length}`,
    `Tool activities: ${payload.activities.length}`,
    "",
    "Extracted conversation summary:",
    `- User messages: ${userTurns.length}`,
    `- Assistant messages: ${assistantTurns.length}`,
  ];

  const userKeywords = extractKeywords(userTurns.map((turn) => turn.content), 12);
  const assistantKeywords = extractKeywords(assistantTurns.map((turn) => turn.content), 12);
  if (userKeywords.length > 0) {
    lines.push(`- Main user intent keywords: ${userKeywords.join(", ")}`);
  }
  if (assistantKeywords.length > 0) {
    lines.push(`- Main assistant response keywords: ${assistantKeywords.join(", ")}`);
  }

  if (toolCounts.size > 0) {
    lines.push("", "Tool activity summary:");
    for (const [tool, count] of [...toolCounts.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))) {
      lines.push(`- ${tool}: ${count.total} call(s), ${count.failed} failed`);
    }
  }

  const fileKeywords = extractKeywords(fileTokens, 12);
  if (fileKeywords.length > 0) {
    lines.push(`- Referenced file/path keywords: ${fileKeywords.join(", ")}`);
  }

  return lines.join("\n");
}

function runExternalSummarizer(command: string, payload: SummaryPayload): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("External summarizer timed out"));
    }, 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `External summarizer exited with code ${code}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function summarizeSession(sessionId: string, projectId: string): Promise<string | null> {
  const payload = buildPayload(sessionId, projectId);
  if (!payload) return null;

  const command = process.env.MEMORY_MCP_SUMMARIZER_COMMAND;
  if (command) {
    try {
      return await runExternalSummarizer(command, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${buildFallbackSummary(payload)}\n\nSummarizer fallback: external summarizer failed (${message}).`;
    }
  }

  if (readDeepSeekConfig().apiKey || process.env.DEEPSEEK_API_KEY) {
    try {
      return await runDeepSeekSummarizer(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${buildFallbackSummary(payload)}\n\nSummarizer fallback: DeepSeek summarizer failed (${message}).`;
    }
  }

  return buildFallbackSummary(payload);
}
