// IntentGuard의 실행 기록을 노트북 03이 읽을 CSV로 옮긴다.
// 원본 JSON에는 도구 호출 전체와 로컬 경로가 들어 있어서, 재집계에 필요한 열만 남긴다.
//
//   pnpm import:intentguard --from ../intentguard
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { from: { type: "string", default: "../intentguard" } } });
const root = path.resolve(values.from!);
const out = path.resolve("analysis/data/intentguard");
mkdirSync(out, { recursive: true });

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(name: string, rows: Record<string, unknown>[]) {
  const cols = Object.keys(rows[0]);
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(","));
  writeFileSync(path.join(out, name), [cols.join(","), ...body].join("\n") + "\n");
  console.log(`${name}: ${rows.length}행`);
}

// 1) 통제 실험 90회: MCP·Web v1 (final-mcp-v1 60회) + Web v2 (final-v2 30회)
//    "확인된 성공"은 성공했고, 답변 검수에서 미확인(unverified)으로 분류되지 않은 실행이다.
const labels = readJson(path.join(root, "docs/results/verification-labels.json")).labels;
const controlled: Record<string, unknown>[] = [];
for (const batch of ["final-mcp-v1", "final-v2"]) {
  const unverified = new Set(Object.keys(labels[batch]?.unverified ?? {}));
  for (const file of readdirSync(path.join(root, "runs", batch)).filter((f) => f.endsWith(".json"))) {
    const r = readJson(path.join(root, "runs", batch, file));
    controlled.push({
      run_id: r.runId,
      task: r.scenarioId,
      path: r.driver === "mcp" ? "mcp" : `web-${r.ui}`,
      rep: Number(r.runId.split("__").at(-1)),
      success: r.grade.success,
      verified: r.grade.success && !unverified.has(r.runId),
      turns: r.numTurns,
      duration_ms: r.durationMs,
      exit_reason: r.exitReason,
    });
  }
}
writeCsv("controlled-90.csv", controlled);

// 2) 모델 4종 교차 검증 80회 (Antigravity CLI)
const multi = readJson(path.join(root, "docs/results/multi-model.json"));
writeCsv(
  "multi-model-80.csv",
  multi.runs.map((r: any) => ({ task: r.task, ui: r.ui, model: r.model, outcome: r.outcome })),
);

// 3) MY DUGOUT 결함 수정 전후 16회. 이 프로젝트의 출발점이 된 기록이다.
//    issues에는 "waiting for locator('aria-ref=e52')"처럼 배경 버튼을 기다린 흔적이 남아 있다.
const dugoutDir = path.join(root, ".intentguard/dugout");
const dugout: Record<string, unknown>[] = [];
if (existsSync(dugoutDir)) {
  for (const build of ["before", "after"]) {
    const stamps = readdirSync(path.join(dugoutDir, build), { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const { name: stamp } of stamps) {
      for (const file of readdirSync(path.join(dugoutDir, build, stamp)).filter((f) => f.endsWith(".json"))) {
        const r = readJson(path.join(dugoutDir, build, stamp, file));
        const issue = (kind: string) => r.issues?.find((i: any) => i.kind === kind)?.count ?? 0;
        dugout.push({
          build,
          started_at: r.startedAt,
          model: r.model,
          outcome: r.outcome,
          game_started: r.grade.checks?.[0]?.met ?? null,
          settings_saved: r.grade.checks?.[1]?.met ?? null,
          steps: r.agent?.steps ?? null,
          target_not_found: issue("target-not-found"),
          agent_misuse: issue("agent-misuse"),
        });
      }
    }
  }
  writeCsv("dugout-16.csv", dugout);
} else {
  console.log("MY DUGOUT 기록(.intentguard/dugout)이 없어 건너뜀");
}

// README에 적었던 수치. 노트북 03이 재집계 결과와 나란히 놓는다.
writeFileSync(
  path.join(out, "reported.json"),
  JSON.stringify(
    {
      source: "IntentGuard README · docs/results/final-comparison.md",
      controlled: { verified: { mcp: 22, "web-v1": 16, "web-v2": 30 }, success: { mcp: 30, "web-v1": 28, "web-v2": 30 }, mean_turns: { mcp: 4.6, "web-v1": 25.7, "web-v2": 14.8 }, n_per_path: 30 },
      multi_model: { pairs: 40, v1_confirmed: 20, v2_confirmed: 33 },
      dugout: { before_success: 6, after_success: 6, per_build: 8 },
    },
    null,
    2,
  ) + "\n",
);
