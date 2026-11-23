// OpenAI 호환 Chat Completions API(기본은 OpenRouter)로 모델을 부르고, 도구 호출은 브라우저 MCP에 직접 넘긴다.
// Antigravity 주간 한도에 막힌 GPT-OSS를 돌리려고 만들었다.
//
// Claude Code·Antigravity와 달리 실행기 자체의 시스템 지시나 내장 도구가 없다. 모델이 받는 것은
// run.ts의 요청문과 브라우저 도구 정의뿐이다. 그래서 같은 모델이라도 Antigravity에서 돈 결과와는
// 조건이 다르다(예: Antigravity에서 GPT-OSS가 run_command로 브라우저를 열려다 막힌 일은 여기서 생길 수 없다).
// B와 D 비교처럼 같은 실행기 안의 비교에만 쓰고, 결과에는 실행기를 구분해 적는다.
//
// 키는 레포 루트의 .env에 OPENROUTER_API_KEY=... 로 넣는다(.gitignore에 있다).
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openMcp, type McpTool } from "../../probe/lib/mcp.js";
import type { AgentInput, AgentRun, BrowserServer, ToolCall } from "./types.js";

/** 한 실행에서 모델 응답을 받는 최대 횟수. 다른 실행기는 시간 제한만 있지만, 여기서는 루프를 직접 돌리므로 안전장치를 둔다 */
const MAX_TURNS = 60;

/** .env의 KEY=VALUE 줄만 읽는다. 이미 환경 변수에 있으면 그쪽을 쓴다 */
function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = path.resolve(".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** 허용 목록에 있는 MCP 도구만 OpenAI 도구 정의로 바꾼다. 막은 도구는 모델에게 아예 보이지 않는다 */
export function toOpenAiTools(tools: McpTool[], browser: BrowserServer) {
  if (!browser.allowed) throw new Error(`${browser.name}: API 실행기는 허용 목록이 있는 서버만 돌린다`);
  const allowed = new Set(browser.allowed);
  return tools
    .filter((t) => allowed.has(t.name) && !browser.denied.includes(t.name))
    .map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } }));
}

/**
 * HTTP 오류를 사용량·용량 오류로 가린다(OpenRouter 기준).
 * 402는 충전한 크레딧이 떨어진 것이고, 401·403은 키가 만료됐거나 잘못된 것이다. 둘 다 기다려도 풀리지 않으므로 멈춘다.
 * 멈춘 실행은 결과를 남기지 않으니 새 키를 넣고 같은 명령을 돌리면 이어서 돈다. 429와 5xx는 잠시 뒤 다시 시도한다.
 */
export function httpLimit(status: number): AgentRun["limit"] {
  if (status === 402 || status === 401 || status === 403) return "quota";
  if (status === 429 || status >= 500) return "retry";
  return null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Anthropic 모델에만 프롬프트 캐시 표시를 붙인다. 이 실행기는 매 턴 대화 전체를 다시 보내므로,
 * 마지막 메시지에 표시를 달아 두면 다음 턴은 그 앞까지를 캐시에서 읽는다(OpenRouter 기준 새 입력의 1/20 가격).
 * 모델이 받는 내용은 같고 비용만 달라진다. 다른 모델의 요청은 그대로 둔다.
 */
export function withCache(model: string, messages: ChatMessage[]): unknown[] {
  if (!model.startsWith("anthropic/")) return messages;
  const last = messages.length - 1;
  return messages.map((m, i) =>
    i === last && m.role !== "assistant" && typeof m.content === "string"
      ? { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
      : m,
  );
}

export async function runOpenAiCompat(o: AgentInput): Promise<AgentRun> {
  const started = Date.now();
  const raw = createWriteStream(o.rawLogPath);
  const log = (entry: object) => raw.write(JSON.stringify(entry) + "\n");
  const result = (r: Omit<AgentRun, "durationMs" | "outsideTools">): AgentRun => {
    raw.end();
    return { ...r, outsideTools: [], durationMs: Date.now() - started };
  };

  const apiKey = envValue("OPENROUTER_API_KEY");
  const baseUrl = envValue("OPENAI_COMPAT_BASE_URL") ?? "https://openrouter.ai/api/v1";
  // Antigravity의 gpt-oss-120b-medium과 맞추려고 추론 강도 기본값을 medium으로 둔다.
  // Claude는 Antigravity에서 claude-sonnet-5-5-low로 돌렸으므로 OPENAI_COMPAT_REASONING_EFFORT=low로 맞춘다
  const effort = envValue("OPENAI_COMPAT_REASONING_EFFORT") ?? "medium";
  if (!apiKey) {
    log({ type: "error", text: "OPENROUTER_API_KEY가 없다. 레포 루트 .env에 넣을 것" });
    return result({ exitReason: "error", numTurns: 0, toolCalls: [], finalAnswer: "", model: "", limit: "quota" });
  }

  const mcp = await openMcp(o.browser.args);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs);
  const calls: ToolCall[] = [];
  let numTurns = 0;
  let model = "";

  try {
    const tools = toOpenAiTools(await mcp.listTools(), o.browser);
    const messages: ChatMessage[] = [{ role: "user", content: o.prompt }];

    while (numTurns < MAX_TURNS) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: o.model, messages: withCache(o.model, messages), tools, reasoning: { effort } }),
        signal: controller.signal,
      });
      const body: any = await res.json().catch(() => ({}));
      log({ type: "response", status: res.status, model: body.model, usage: body.usage, error: body.error, message: body.choices?.[0]?.message });
      if (!res.ok || body.error) {
        const status = res.ok ? Number(body.error?.code) || 500 : res.status;
        return result({ exitReason: "error", numTurns, toolCalls: calls, finalAnswer: "", model, limit: httpLimit(status) });
      }

      numTurns++;
      model = body.model ?? model;
      const message = body.choices?.[0]?.message ?? {};
      const toolCalls: NonNullable<ChatMessage["tool_calls"]> = message.tool_calls ?? [];
      messages.push({ role: "assistant", content: message.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });

      // 도구를 부르지 않으면 최종 답이다
      if (!toolCalls.length) {
        return result({ exitReason: "completed", numTurns, toolCalls: calls, finalAnswer: String(message.content ?? "").trim(), model, limit: null });
      }

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        let reply: { text: string; isError: boolean };
        try {
          args = JSON.parse(tc.function.arguments || "{}");
          // 정의에 없는 도구 이름이면 MCP에 넘기지 않고 오류로 돌려준다
          reply = tools.some((t) => t.function.name === tc.function.name)
            ? await mcp.call(tc.function.name, args)
            : { text: `Unknown tool: ${tc.function.name}`, isError: true };
        } catch (e) {
          reply = { text: `Invalid tool arguments: ${String(e)}`, isError: true };
        }
        // Playwright MCP는 실패도 정상 응답 본문의 "### Error"로 돌려준다(Antigravity 실행기와 같은 기준)
        const isError = reply.isError || reply.text.startsWith("### Error");
        calls.push({ name: tc.function.name, input: args, isError, resultPreview: reply.text.slice(0, 600) });
        log({ type: "tool", name: tc.function.name, input: args, isError, result: reply.text.slice(0, 2000) });
        messages.push({ role: "tool", tool_call_id: tc.id, content: reply.text });
      }
    }
    log({ type: "error", text: `모델 응답 ${MAX_TURNS}회를 넘어 멈춤` });
    return result({ exitReason: "timeout", numTurns, toolCalls: calls, finalAnswer: "", model, limit: null });
  } catch (e) {
    const timedOut = controller.signal.aborted;
    log({ type: "error", text: String(e) });
    return result({ exitReason: timedOut ? "timeout" : "error", numTurns, toolCalls: calls, finalAnswer: "", model, limit: timedOut ? null : "retry" });
  } finally {
    clearTimeout(timer);
    await mcp.close().catch(() => {});
  }
}
