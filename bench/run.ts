// 2층: 모달 과제를 실제 에이전트에게 시키고 서버 상태로 채점한다.
//
//   pnpm bench --model claude-haiku-5-5 --impl B --task settings-then-start --reps 1
//   pnpm bench --model claude-sonnet-5-5 --browser devtools      (DevTools MCP로 보조 실험)
//
// 기본 실험은 과제 4 × 구현 4 × 모델 3 × 3회 = 144회다. 모델 비용이 들기 때문에 1층에서
// 차이가 난 조건만 넘긴다. 결과는 runs/layer2/<browser>/<task>__<impl>__<model>__<rep>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { IMPLS, type Impl } from "../probe/human.js";
import { TMP, devtoolsMcpArgs, playwrightMcpArgs } from "../probe/lib/mcp.js";
import { classifyClickError } from "../probe/parse.js";
import { startServer } from "../probe/serve.js";
import { runClaude, type ToolCall } from "./claude.js";
import { TASKS, outcomeOf, type ModalState } from "./tasks.js";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "claude-haiku-5-5" },
    browser: { type: "string", default: "playwright" },
    impl: { type: "string", multiple: true },
    task: { type: "string", multiple: true },
    reps: { type: "string", default: "3" },
    timeout: { type: "string", default: "300" },
  },
});

const browser = values.browser === "devtools" ? "devtools" : "playwright";
const impls = (values.impl?.length ? values.impl : IMPLS).filter((i): i is Impl => (IMPLS as readonly string[]).includes(i));
const tasks = values.task?.length ? TASKS.filter((t) => values.task!.includes(t.id)) : TASKS;
const reps = Number(values.reps);

/**
 * 에이전트에게는 브라우저 MCP 하나만 준다. 셸·파일 도구는 없다(--tools "").
 * 페이지 안에서 JS를 돌리는 도구는 막는다. 그러면 화면을 거치지 않고 DOM을 직접 만질 수 있어서다.
 */
function agentSetup() {
  if (browser === "devtools") {
    return {
      server: { "chrome-devtools": { command: process.execPath, args: devtoolsMcpArgs() } },
      allowed: ["mcp__chrome-devtools"],
      blocked: ["evaluate_script", "take_screenshot", "list_network_requests", "get_network_request"].map((t) => `mcp__chrome-devtools__${t}`),
    };
  }
  return {
    server: { playwright: { command: process.execPath, args: [...playwrightMcpArgs(), "--image-responses", "omit"] } },
    allowed: ["mcp__playwright"],
    blocked: ["browser_evaluate", "browser_run_code_unsafe", "browser_take_screenshot", "browser_network_requests"].map((t) => `mcp__playwright__${t}`),
  };
}

/**
 * 배경 요소를 누르려다 막힌 흔적. 1층과 같은 분류 함수를 써서 가로막힘과 시간 초과만 센다.
 * inert 배경은 "element is inert"로 기다리다 시간 초과가 나므로 timeout 쪽으로 들어간다.
 */
function blockedClicks(calls: ToolCall[]): number {
  return calls.filter((c) => {
    if (!/click/i.test(c.name) || !c.isError) return false;
    const kind = classifyClickError(c.resultPreview);
    return kind === "intercepted" || kind === "timeout";
  }).length;
}

const server = await startServer();
const outDir = path.resolve("runs/layer2", browser);
const rawDir = path.join(outDir, "raw");
mkdirSync(rawDir, { recursive: true });
const setup = agentSetup();
const mcpConfigPath = path.join(TMP, `mcp-${browser}.json`);
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: setup.server }));

try {
  for (const task of tasks)
    for (const impl of impls)
      for (let rep = 1; rep <= reps; rep++) {
        const runId = `${task.id}__${impl}__${values.model}__${rep}`;
        const url = `${server.url}/modal/?impl=${impl}&run=${encodeURIComponent(runId)}${task.startOpen ? "&open=1" : ""}`;
        const prompt =
          `너는 사용자를 대신해 웹 화면을 조작하는 에이전트야. 브라우저 도구로 ${url} 을 열어 화면을 조작해서 아래 요청을 처리해. ` +
          `끝나면 무엇을 했는지 한두 문장으로 보고하고, 마지막 줄에 결과를 화면에서 직접 확인했으면 "RESULT: confirmed", 아니면 "RESULT: unconfirmed"라고 적어.\n\n요청: ${task.prompt}`;

        const run = await runClaude({
          prompt,
          timeoutMs: Number(values.timeout) * 1000,
          rawLogPath: path.join(rawDir, `${runId}.jsonl`),
          args: [
            "-p",
            "--model", values.model!,
            "--output-format", "stream-json",
            "--verbose",
            "--tools", "",
            "--mcp-config", mcpConfigPath,
            "--strict-mcp-config",
            "--allowedTools", ...setup.allowed,
            "--disallowedTools", ...setup.blocked,
            "--setting-sources", "local",
            "--no-session-persistence",
          ],
        });

        const state = (server.state.get(runId) as ModalState | undefined) ?? null;
        const grade = task.grade(state, run.finalAnswer);
        const record = {
          runId,
          task: task.id,
          impl,
          browser,
          model: run.model || values.model,
          rep,
          outcome: outcomeOf(grade, run.finalAnswer),
          grade,
          numTurns: run.numTurns,
          blockedClicks: blockedClicks(run.toolCalls),
          exitReason: run.exitReason,
          durationMs: run.durationMs,
          state,
          finalAnswer: run.finalAnswer,
          toolCalls: run.toolCalls,
        };
        writeFileSync(path.join(outDir, `${runId}.json`), JSON.stringify(record, null, 2) + "\n");
        console.log(`${runId.padEnd(60)} ${record.outcome.padEnd(20)} 턴 ${record.numTurns}  막힌 클릭 ${record.blockedClicks}`);
      }
} finally {
  await server.close();
}
