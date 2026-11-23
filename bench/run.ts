// 2층: 모달 과제를 실제 에이전트에게 시키고 서버 상태로 채점한다.
//
//   pnpm bench --model claude-haiku-5-5 --impl B --task settings-then-start --reps 1
//   pnpm bench --agent antigravity --model gpt-oss-120b-medium --impl B --reps 1
//   pnpm bench --model claude-sonnet-5-5 --browser devtools      (DevTools MCP로 보조 실험)
//
// 기본 실험은 과제 4 × 구현 4 × 모델 3 × 3회 = 144회다. 모델 비용이 들기 때문에 1층에서
// 차이가 난 조건만 넘긴다. 결과는 runs/layer2/<browser>/<task>__<impl>__<model>__<rep>.json.
//
// Claude 모델은 Claude Code로, Gemini·GPT-OSS는 Antigravity CLI로 돌린다. 두 실행기는 같은 브라우저 MCP와
// 같은 도구 권한(agents/browser.ts)을 쓰지만 턴을 세는 방식이 달라서, 턴 수는 같은 실행기 안에서만 비교한다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { IMPLS, type Impl } from "../probe/human.js";
import { startServer } from "../probe/serve.js";
import { runAntigravity } from "./agents/antigravity.js";
import { browserServer } from "./agents/browser.js";
import { runClaudeCode } from "./agents/claude-code.js";
import { ambiguousTargets, blockedClicks } from "./metrics.js";
import { TASKS, invalidReason, outcomeOf, type ModalState } from "./tasks.js";

const { values } = parseArgs({
  options: {
    agent: { type: "string", default: "claude-code" },
    model: { type: "string", default: "claude-haiku-5-5" },
    browser: { type: "string", default: "playwright" },
    impl: { type: "string", multiple: true },
    task: { type: "string", multiple: true },
    reps: { type: "string", default: "3" },
    timeout: { type: "string", default: "300" },
  },
});

const agent = values.agent === "antigravity" ? "antigravity" : "claude-code";
const browser = values.browser === "devtools" ? "devtools" : "playwright";
const impls = (values.impl?.length ? values.impl : IMPLS).filter((i): i is Impl => (IMPLS as readonly string[]).includes(i));
const tasks = values.task?.length ? TASKS.filter((t) => values.task!.includes(t.id)) : TASKS;
const reps = Number(values.reps);
const runAgent = agent === "antigravity" ? runAntigravity : runClaudeCode;
if (agent === "antigravity" && !browserServer(browser).allowed) {
  throw new Error("Antigravity는 Playwright MCP로만 돌린다. DevTools MCP는 허용 목록을 정리해 두지 않았다 (agents/browser.ts)");
}

const server = await startServer();
const outDir = path.resolve("runs/layer2", browser);
const rawDir = path.join(outDir, "raw");
mkdirSync(rawDir, { recursive: true });

try {
  for (const task of tasks)
    for (const impl of impls)
      for (let rep = 1; rep <= reps; rep++) {
        const runId = `${task.id}__${impl}__${values.model}__${rep}`;
        const url = `${server.url}/modal/?impl=${impl}&run=${encodeURIComponent(runId)}${task.startOpen ? "&open=1" : ""}`;
        const prompt =
          `너는 사용자를 대신해 웹 화면을 조작하는 에이전트야. 브라우저 도구로 ${url} 을 열어 화면을 조작해서 아래 요청을 처리해. ` +
          `끝나면 무엇을 했는지 한두 문장으로 보고하고, 마지막 줄에 결과를 화면에서 직접 확인했으면 "RESULT: confirmed", 아니면 "RESULT: unconfirmed"라고 적어.\n\n요청: ${task.prompt}`;

        const run = await runAgent({
          model: values.model!,
          prompt,
          timeoutMs: Number(values.timeout) * 1000,
          rawLogPath: path.join(rawDir, `${runId}.jsonl`),
          browser: browserServer(browser),
        });

        const state = (server.state.get(runId) as ModalState | undefined) ?? null;
        const grade = task.grade(state, run.finalAnswer);
        const invalid = invalidReason(run);
        const record = {
          runId,
          task: task.id,
          impl,
          browser,
          agent,
          model: run.model || values.model,
          rep,
          outcome: invalid ? "invalid" : outcomeOf(grade, run.finalAnswer),
          invalid,
          grade,
          numTurns: run.numTurns,
          blockedClicks: blockedClicks(run.toolCalls),
          ambiguousTargets: ambiguousTargets(run.toolCalls),
          exitReason: run.exitReason,
          durationMs: run.durationMs,
          state,
          finalAnswer: run.finalAnswer,
          toolCalls: run.toolCalls,
        };
        writeFileSync(path.join(outDir, `${runId}.json`), JSON.stringify(record, null, 2) + "\n");
        console.log(`${runId.padEnd(60)} ${record.outcome.padEnd(20)} 턴 ${record.numTurns}  막힌 클릭 ${record.blockedClicks}  대상 중복 ${record.ambiguousTargets}${invalid ? `  (${invalid})` : ""}`);
      }
} finally {
  await server.close();
}
