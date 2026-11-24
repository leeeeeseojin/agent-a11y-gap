// 2층 연장: 연구용 테스트 페이지 대신 실제 앱(MY DUGOUT)에 같은 API 실행기를 돌린다.
//
//   pnpm bench:app --url http://localhost:4320/ --label after --reps 1
//
// 과제와 채점 기준은 IntentGuard의 MY DUGOUT 시나리오(audits/my-dugout.json)를 그대로 가져왔다.
// 처음 사례(수정 전후 6/8 → 6/8)와 같은 과제여야 비교가 되기 때문이다.
//
// MY DUGOUT은 상태를 서버로 보내지 않고 localStorage와 화면에만 둔다. 그래서 IntentGuard처럼
// 브라우저를 여기서 띄우고, 에이전트의 Playwright MCP는 CDP로 그 브라우저에 붙인다.
// 에이전트가 끝나면 같은 브라우저의 최종 화면과 localStorage로 채점한다.
import { chromium, type BrowserContext } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { TMP, pkgDir } from "../probe/lib/mcp.js";
import { browserServer } from "./agents/browser.js";
import { runOpenAiCompat } from "./agents/openai-compat.js";
import type { BrowserServer } from "./agents/types.js";
import { ambiguousTargets, blockedClicks } from "./metrics.js";
import { redactPaths } from "./redact.js";
import { invalidReason, outcomeOf, type Grade } from "./tasks.js";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    // 어떤 빌드인지. 결과 파일 이름에 들어간다 (예: before = B 구현, after = D 구현)
    label: { type: "string" },
    model: { type: "string", default: "openai/gpt-oss-120b" },
    reps: { type: "string", default: "1" },
    timeout: { type: "string", default: "600" },
  },
});
if (!values.url || !values.label) throw new Error("--url과 --label이 필요하다");

const TASK =
  "내 구단은 한화로 고르고 원정 경기로 맞춰줘. 운영 방식에서 공격 작전만 코치에게 맡기고 투수·수비는 내가 하도록 둔 다음, " +
  "경기를 시작해줘. 경기가 시작되면 끝까지 진행하지 말고 거기서 멈춰.";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** 기존 Playwright MCP 설정에서 브라우저를 직접 띄우는 옵션만 빼고, 이미 떠 있는 브라우저에 붙게 바꾼다 */
function attachedServer(cdp: string): BrowserServer {
  const base = browserServer("playwright");
  return { ...base, args: [path.join(pkgDir("@playwright/mcp"), "cli.js"), "--cdp-endpoint", cdp, "--output-dir", path.join(TMP, "pw-mcp"), "--image-responses", "omit"] };
}

/** IntentGuard 시나리오의 두 확인 항목 */
async function grade(context: BrowserContext): Promise<Grade & { settings: unknown }> {
  const page = context.pages().at(-1);
  if (!page) return { success: false, notes: ["열린 화면이 없음"], settings: null };
  const myTeam = await page.locator(".sb-team:first-child .sb-name:has(small)").textContent({ timeout: 2000 }).catch(() => null);
  const raw = await page.evaluate(() => localStorage.getItem("my-dugout:settings")).catch(() => null);
  const settings = raw ? JSON.parse(raw) : null;
  const notes: string[] = [];
  if (!myTeam?.includes("한화")) notes.push("경기가 시작되지 않았거나 원정팀이 한화가 아님");
  if (settings?.offense !== "coach" || settings?.defense !== "me") notes.push("공격 작전은 코치에게, 투수·수비는 내가로 저장되지 않음");
  return { success: notes.length === 0, notes: notes.length ? notes : ["모든 조건 충족"], settings };
}

/** 원본 로그에서 모델 호출마다의 입력 토큰과 OpenRouter가 알려 준 비용을 모은다 */
function usageOf(rawLog: string) {
  const turns = readFileSync(rawLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "response" && e.usage);
  const sum = (f: (u: any) => number) => turns.reduce((a, e) => a + (f(e.usage) || 0), 0);
  return {
    calls: turns.length,
    promptTokens: sum((u) => u.prompt_tokens),
    completionTokens: sum((u) => u.completion_tokens),
    maxPromptTokens: Math.max(0, ...turns.map((e) => e.usage.prompt_tokens ?? 0)),
    costUsd: Number(sum((u) => u.cost).toFixed(5)),
  };
}

/** 스냅샷 한 번의 크기. 모델이 매 턴 다시 받는 양이라 비용의 대부분을 정한다 */
function snapshotSizes(rawLog: string) {
  return readFileSync(rawLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "tool" && e.name === "browser_snapshot")
    .map((e) => e.fullLength as number);
}

const modelKey = values.model!.replaceAll("/", "-");
const outDir = path.resolve("runs/app/my-dugout");
const rawDir = path.join(outDir, "raw");
mkdirSync(rawDir, { recursive: true });

for (let rep = 1; rep <= Number(values.reps); rep++) {
  const runId = `${values.label}__${modelKey}__${rep}`;
  const port = await freePort();
  const profile = mkdtempSync(path.join(TMP, "app-browser-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    args: [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
  });
  try {
    const rawLogPath = path.join(rawDir, `${runId}.jsonl`);
    const prompt =
      `너는 사용자를 대신해 웹 화면을 조작하는 에이전트야. 브라우저 도구로 ${values.url} 을 열어 화면을 조작해서 아래 요청을 처리해. ` +
      `끝나면 무엇을 했는지 한두 문장으로 보고하고, 마지막 줄에 결과를 화면에서 직접 확인했으면 "RESULT: confirmed", 아니면 "RESULT: unconfirmed"라고 적어.\n\n요청: ${TASK}`;
    const run = await runOpenAiCompat({
      model: values.model!,
      prompt,
      timeoutMs: Number(values.timeout) * 1000,
      rawLogPath,
      browser: attachedServer(`http://127.0.0.1:${port}`),
    });
    const g = await grade(context);
    const invalid = invalidReason(run);
    const record = {
      runId,
      app: "my-dugout",
      label: values.label,
      url: values.url,
      agent: "api",
      model: run.model || values.model,
      rep,
      outcome: invalid ? "invalid" : outcomeOf(g, run.finalAnswer),
      invalid,
      grade: { success: g.success, notes: g.notes },
      settings: g.settings,
      numTurns: run.numTurns,
      blockedClicks: blockedClicks(run.toolCalls),
      ambiguousTargets: ambiguousTargets(run.toolCalls),
      usage: usageOf(rawLogPath),
      snapshotChars: snapshotSizes(rawLogPath),
      exitReason: run.exitReason,
      durationMs: run.durationMs,
      finalAnswer: run.finalAnswer,
      toolCalls: run.toolCalls,
    };
    writeFileSync(path.join(outDir, `${runId}.json`), redactPaths(JSON.stringify(record, null, 2)) + "\n");
    console.log(`${runId} ${record.outcome} 턴 ${record.numTurns} 막힌 클릭 ${record.blockedClicks} 입력 토큰 ${record.usage.promptTokens} 비용 $${record.usage.costUsd}`);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
