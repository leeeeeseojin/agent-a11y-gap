// Antigravity CLI(agy)를 헤드리스로 실행한다. Gemini와 GPT-OSS는 이 실행기로만 돌릴 수 있다.
// IntentGuard src/audit/antigravity.ts를 옮겼다. 거기서는 이미 떠 있는 브라우저에 --cdp-endpoint로 붙었지만,
// 여기서는 Claude Code 실행과 같은 조건이 되도록 MCP가 매번 새 브라우저(--isolated)를 띄운다.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentInput, AgentRun, ToolCall } from "./types.js";

/** 플러그인으로 넣은 MCP 서버는 "플러그인 이름_서버 이름"으로 불린다. 권한 규칙도 이 이름을 써야 한다 */
const PLUGIN = "agent-a11y-gap-browser";

/** 화면을 거치지 않는 agy 내장 도구. Deny가 사용자의 전역 Allow보다 우선한다 */
const AGY_DENIED = ["command(*)", "unsandboxed(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"];

/** 작업 결과에 영향을 주지 않는 CLI 내부 도구 */
const HARMLESS = new Set(["finish", "wait", "list_permissions"]);

export function resolveAgy(): string {
  if (process.env.AGY_BIN) return process.env.AGY_BIN;
  if (process.env.LOCALAPPDATA) {
    const exe = path.join(process.env.LOCALAPPDATA, "agy/bin/agy.exe");
    if (existsSync(exe)) return exe;
  }
  return "agy";
}

/**
 * 실행기 오류가 사용량·용량 때문인지 가린다. 두 오류 모두 본실험 중에 실제로 받은 문장이다.
 * - GPT-OSS: "UNAVAILABLE (code 503): No capacity available for model ..." → 몇 분 뒤 풀린다
 * - Sonnet·GPT-OSS: "RESOURCE_EXHAUSTED (code 429): Individual quota reached. ... Resets in 149h..." → 계정 한도다
 * agy는 429에도 retryable: true를 붙이므로 그 표시만 믿으면 며칠짜리 한도를 계속 다시 시도하게 된다. 그래서 한도를 먼저 본다
 */
export function agyLimit(text: string): AgentRun["limit"] {
  if (/Individual quota reached|RESOURCE_EXHAUSTED|code 429/i.test(text)) return "quota";
  if (/No capacity available|UNAVAILABLE|code 503/i.test(text)) return "retry";
  return null;
}

/** agy --output-format stream-json 출력을 실행 결과로 바꾼다. 테스트에서 직접 부를 수 있게 따로 뺐다 */
export function parseAgyStream(lines: string[], serverName: string): Omit<AgentRun, "durationMs" | "limit"> & { status: string; error: string } {
  const calls: ToolCall[] = [];
  const outside: string[] = [];
  let numTurns = 0;
  let finalAnswer = "";
  let model = "";
  let status = "";
  let error = "";

  for (const line of lines) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.init?.model) model = String(message.init.model);
    const step = message.step_update;
    if (step?.step_type === "agent_response" && step.state === "DONE") numTurns++;
    if (step?.step_type === "tool" && (step.state === "DONE" || step.state === "ERROR")) {
      const params = step.tool_info?.parameters ?? {};
      const toolName = String(step.tool_name);
      // 브라우저 도구 호출은 두 모양으로 온다. call_mcp_tool로 서버와 도구 이름을 따로 넘기거나(IntentGuard 때 본 모양),
      // "mcp_<서버>_<도구>"라는 이름으로 직접 부른다(agy 1.5.14에서 Gemini가 쓴 모양). 둘 다 브라우저 호출로 센다
      const direct = toolName.startsWith(`mcp_${serverName}_`) ? toolName.slice(`mcp_${serverName}_`.length) : null;
      const viaCall = toolName === "call_mcp_tool" && params.ServerName === serverName;
      const browser = viaCall || direct !== null;
      const output = String(step.tool_info?.error?.message ?? step.tool_info?.output ?? "");
      calls.push({
        name: direct ?? (viaCall ? String(params.ToolName) : toolName),
        input: direct !== null ? params : viaCall ? params.Arguments : params,
        // Playwright MCP는 실패도 정상 응답 본문의 "### Error"로 돌려준다
        isError: step.state === "ERROR" || output.startsWith("### Error"),
        resultPreview: output.slice(0, 600),
      });
      if (!browser && step.state === "DONE" && !HARMLESS.has(toolName)) outside.push(toolName);
    }
    if (message.result) {
      status = message.result.status ?? "";
      finalAnswer = String(message.result.response ?? "").trim();
      error = String(message.result.error ?? "");
    }
  }
  return {
    exitReason: status === "SUCCESS" && finalAnswer ? "completed" : "error",
    numTurns,
    toolCalls: calls,
    finalAnswer,
    model,
    outsideTools: [...new Set(outside)],
    status,
    error,
  };
}

/**
 * 실행마다 저장소 밖의 빈 폴더를 만들어 그 안의 플러그인과 이번 실행 전용 --settings만 쓴다.
 * 그래서 사용자의 전역 agy 설정은 바뀌지 않는다. --dangerously-skip-permissions는 쓰지 않는다.
 */
function prepareWorkDir(o: AgentInput): { workDir: string; settings: string } {
  const b = o.browser;
  if (!b.allowed) throw new Error(`${b.name}: Antigravity는 허용 목록이 없는 서버를 돌릴 수 없다 (목록에 없는 도구를 부르면 세션이 끝난다)`);

  const workDir = mkdtempSync(path.join(os.tmpdir(), "agent-a11y-gap-agy-"));
  const plugin = path.join(workDir, ".agents/plugins", PLUGIN);
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "plugin.json"), JSON.stringify({ name: PLUGIN }));
  writeFileSync(path.join(plugin, "mcp_config.json"), JSON.stringify({ mcpServers: { [b.name]: { command: b.command, args: b.args } } }));

  const server = `${PLUGIN}_${b.name}`;
  const rule = (tool: string) => `mcp(${server}/${tool})`;
  const settings = path.join(workDir, "session.json");
  writeFileSync(settings, JSON.stringify({ permissions: { allow: b.allowed.map(rule), deny: [...AGY_DENIED, ...b.denied.map(rule)] } }));
  return { workDir, settings };
}

export function runAntigravity(o: AgentInput): Promise<AgentRun> {
  const { workDir, settings } = prepareWorkDir(o);
  const serverName = `${PLUGIN}_${o.browser.name}`;
  const args = [
    "--model", o.model, "--settings", settings, "--output-format", "stream-json", "--disable-slash-commands",
    "--print-timeout", `${Math.ceil(o.timeoutMs / 1000)}s`, "-p", o.prompt,
  ];

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(resolveAgy(), args, { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const raw = createWriteStream(o.rawLogPath);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    // agy의 --print-timeout이 먼저 끝내야 정상이다. 이 타이머는 CLI가 멈췄을 때만 쓰인다
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else process.kill(-child.pid!, "SIGKILL");
      } catch {
        // 이미 끝난 프로세스면 할 일이 없다
      }
    }, o.timeoutMs + 10_000);

    const finish = (spawnError = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stderr || spawnError) raw.write(JSON.stringify({ type: "stderr", text: spawnError || stderr }) + "\n");
      raw.end();
      const { status: _status, error, ...parsed } = parseAgyStream(stdout.split("\n"), serverName);
      resolve({
        ...parsed,
        // 시간 초과는 에이전트가 과제를 못 끝낸 것이므로 무효가 아니라 실패로 센다
        exitReason: timedOut || /print timeout/.test(error + stderr) ? "timeout" : spawnError ? "error" : parsed.exitReason,
        limit: !timedOut && parsed.exitReason === "error" ? agyLimit(error + stderr) : null,
        durationMs: Date.now() - started,
      });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      raw.write(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (err) => finish(`Antigravity CLI를 실행할 수 없다 (${err.message}). AGY_BIN으로 경로를 지정할 것`));
    child.on("close", () => finish());
  });
}
