// 2층: 모달 과제를 실제 에이전트에게 시키고 서버 상태로 채점한다.
//
//   pnpm bench --model claude-haiku-5-5 --impl B --task settings-then-start --reps 1
//   pnpm bench --agent antigravity --model gpt-oss-120b-medium --impl B --reps 1
//   pnpm bench --agent api --model openai/gpt-oss-120b --impl B --reps 1   (OpenRouter, 키는 .env)
//   pnpm bench --model claude-sonnet-5-5 --browser devtools      (DevTools MCP로 보조 실험)
//
// 기본 실험은 과제 4 × 구현 4 × 모델 3 × 3회 = 144회다. 모델 비용이 들기 때문에 1층에서
// 차이가 난 조건만 넘긴다. 결과는 runs/layer2/<browser>/<task>__<impl>__<model>__<rep>.json.
//
// Claude 모델은 Claude Code로, Gemini·GPT-OSS는 Antigravity CLI로 돌린다. Antigravity 한도에 막힌 모델은
// OpenAI 호환 API 실행기(--agent api)로 돌릴 수 있다. 세 실행기는 같은 브라우저 MCP와 같은 도구 권한(agents/browser.ts)을
// 쓰지만 시스템 지시와 턴을 세는 방식이 달라서, 턴 수와 성공률은 같은 실행기 안에서만 비교한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { IMPLS, type Impl } from "../probe/human.js";
import { startServer } from "../probe/serve.js";
import { runAntigravity } from "./agents/antigravity.js";
import { browserServer } from "./agents/browser.js";
import { runClaudeCode } from "./agents/claude-code.js";
import { runOpenAiCompat } from "./agents/openai-compat.js";
import type { AgentRun } from "./agents/types.js";
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

const AGENTS = { "claude-code": runClaudeCode, antigravity: runAntigravity, api: runOpenAiCompat } as const;
type Agent = keyof typeof AGENTS;
if (!(values.agent! in AGENTS)) throw new Error(`--agent는 ${Object.keys(AGENTS).join(", ")} 중 하나`);
const agent = values.agent as Agent;
const browser = values.browser === "devtools" ? "devtools" : "playwright";
const impls = (values.impl?.length ? values.impl : IMPLS).filter((i): i is Impl => (IMPLS as readonly string[]).includes(i));
const tasks = values.task?.length ? TASKS.filter((t) => values.task!.includes(t.id)) : TASKS;
const reps = Number(values.reps);
const runAgent = AGENTS[agent];
// API 모델 이름(openai/gpt-oss-120b)의 "/"는 파일 이름에 쓸 수 없어서 바꾼다
const modelKey = values.model!.replaceAll("/", "-");
const MAX_ATTEMPTS = 4;
const RETRY_WAIT_MS = 60_000;
if (agent !== "claude-code" && !browserServer(browser).allowed) {
  throw new Error(`${agent}는 Playwright MCP로만 돌린다. DevTools MCP는 허용 목록을 정리해 두지 않았다 (agents/browser.ts)`);
}

const server = await startServer();
const outDir = path.resolve("runs/layer2", browser);
const rawDir = path.join(outDir, "raw");
mkdirSync(rawDir, { recursive: true });

/**
 * 이미 유효한 결과가 있는 실행. 같은 조건을 다시 돌리지 않고 그 결과를 쓴다.
 * 무효로 기록된 실행(한도·연결 오류, 브라우저 밖 도구)은 다시 돌려야 하므로 끝난 것으로 보지 않는다.
 */
function alreadyDone(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    return !JSON.parse(readFileSync(file, "utf8")).invalid;
  } catch {
    return false;
  }
}

let skipped = 0;
try {
  run: for (const task of tasks)
    for (const impl of impls)
      for (let rep = 1; rep <= reps; rep++) {
        const runId = `${task.id}__${impl}__${modelKey}__${rep}`;
        if (alreadyDone(path.join(outDir, `${runId}.json`))) {
          skipped++;
          continue;
        }
        // 모델 서버 용량 부족 같은 일시 오류는 에이전트의 실패가 아니므로 잠시 기다렸다 같은 조건으로 다시 돌린다.
        // 시도마다 상태 키를 달리해서, 중간에 끊긴 시도가 남긴 화면 상태가 다음 시도의 채점에 섞이지 않게 한다
        let run: AgentRun;
        let stateKey = runId;
        let attempt = 1;
        for (;; attempt++) {
          stateKey = attempt === 1 ? runId : `${runId}~${attempt}`;
          const url = `${server.url}/modal/?impl=${impl}&run=${encodeURIComponent(stateKey)}${task.startOpen ? "&open=1" : ""}`;
          const prompt =
            `너는 사용자를 대신해 웹 화면을 조작하는 에이전트야. 브라우저 도구로 ${url} 을 열어 화면을 조작해서 아래 요청을 처리해. ` +
            `끝나면 무엇을 했는지 한두 문장으로 보고하고, 마지막 줄에 결과를 화면에서 직접 확인했으면 "RESULT: confirmed", 아니면 "RESULT: unconfirmed"라고 적어.\n\n요청: ${task.prompt}`;

          run = await runAgent({
            model: values.model!,
            prompt,
            timeoutMs: Number(values.timeout) * 1000,
            rawLogPath: path.join(rawDir, `${runId}${attempt === 1 ? "" : `~${attempt}`}.jsonl`),
            browser: browserServer(browser),
          });
          if (run.limit !== "retry" || attempt >= MAX_ATTEMPTS) break;
          console.log(`${runId} 일시 오류로 ${RETRY_WAIT_MS / 1000}초 뒤 다시 시도 (${attempt}/${MAX_ATTEMPTS})`);
          await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
        }

        // 계정 한도는 며칠 뒤에야 풀린다. 남은 실행도 모두 같은 오류로 끝나므로 결과를 남기지 않고 여기서 멈춘다.
        // 결과 파일이 없으니 한도가 풀린 뒤 같은 명령을 다시 돌리면 이 실행부터 이어서 돈다
        if (run.limit === "quota") {
          console.log(`${runId} 계정 사용량 한도에 걸려 멈춘다. 한도가 풀린 뒤 같은 명령으로 이어서 돌리면 된다`);
          process.exitCode = 2;
          break run;
        }

        const state = (server.state.get(stateKey) as ModalState | undefined) ?? null;
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
          attempts: attempt,
          durationMs: run.durationMs,
          state,
          finalAnswer: run.finalAnswer,
          toolCalls: run.toolCalls,
        };
        writeFileSync(path.join(outDir, `${runId}.json`), JSON.stringify(record, null, 2) + "\n");
        console.log(`${runId.padEnd(60)} ${record.outcome.padEnd(20)} 턴 ${record.numTurns}  막힌 클릭 ${record.blockedClicks}  대상 중복 ${record.ambiguousTargets}${invalid ? `  (${invalid})` : ""}`);
      }
} finally {
  if (skipped) console.log(`이미 결과가 있어 건너뛴 실행 ${skipped}회`);
  await server.close();
}
