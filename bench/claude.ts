// Claude Code를 헤드리스로 실행하고 stream-json 출력에서 도구 호출과 턴 수를 뽑는다.
// IntentGuard src/bench/claude.ts를 옮기면서 이 실험에 필요 없는 비용·토큰 집계는 뺐다.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";

export interface ToolCall {
  name: string;
  input: unknown;
  isError: boolean;
  /** 결과 앞부분. 배경 클릭 시도와 오류 문장을 세는 데 쓴다 */
  resultPreview: string;
}

export interface ClaudeRun {
  durationMs: number;
  exitReason: "completed" | "timeout" | "error";
  numTurns: number;
  toolCalls: ToolCall[];
  finalAnswer: string;
  model: string;
}

export function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}

function killTree(pid: number) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // 이미 끝난 프로세스
  }
}

interface Item {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | { text?: string }[];
}

const textOf = (c: Item["content"]) => (typeof c === "string" ? c : (c ?? []).map((x) => x.text ?? "").join("\n"));

export function runClaude(o: { args: string[]; prompt: string; timeoutMs: number; rawLogPath: string }): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(resolveClaudeBin(), o.args, { stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    const raw = createWriteStream(o.rawLogPath);
    const calls = new Map<string, ToolCall>();
    let buffer = "";
    let final: Record<string, any> | null = null;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, o.timeoutMs);

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      raw.write(line + "\n");
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const items: Item[] = Array.isArray(msg.message?.content) ? msg.message.content : [];
      if (msg.type === "assistant") {
        for (const it of items) if (it.type === "tool_use" && it.id) calls.set(it.id, { name: it.name ?? "?", input: it.input, isError: false, resultPreview: "" });
      } else if (msg.type === "user") {
        for (const it of items) {
          const call = it.tool_use_id ? calls.get(it.tool_use_id) : undefined;
          if (it.type === "tool_result" && call) {
            call.isError = !!it.is_error;
            call.resultPreview = textOf(it.content).slice(0, 600);
          }
        }
      } else if (msg.type === "result") {
        final = msg;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => raw.write(JSON.stringify({ type: "stderr", text: chunk.toString("utf8") }) + "\n"));
    child.on("error", () => child.emit("close"));
    child.stdin.on("error", () => {});
    child.stdin.end(o.prompt);

    let settled = false;
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handleLine(buffer);
      raw.end();
      const f = final as Record<string, any> | null;
      resolve({
        durationMs: Date.now() - started,
        exitReason: timedOut ? "timeout" : f && !f.is_error ? "completed" : "error",
        numTurns: f?.num_turns ?? 0,
        toolCalls: [...calls.values()],
        finalAnswer: typeof f?.result === "string" ? f.result : "",
        model: Object.keys(f?.modelUsage ?? {})[0] ?? "",
      });
    });
  });
}
