// 두 1층 결과를 비교해 달라진 칸을 마크다운 표로 출력한다. CI가 새 MCP 버전으로 돌린 결과를
// 커밋된 runs/layer1/latest.json과 비교할 때 쓴다.
//
//   npx tsx probe/compare.ts runs/layer1/latest.json <새 results.json>
import { readFileSync } from "node:fs";
import type { Layer1Result, Observation } from "./types.js";

const [beforePath, afterPath] = process.argv.slice(2);
const load = (p: string): Layer1Result => JSON.parse(readFileSync(p, "utf8"));
const before = load(beforePath);
const after = load(afterPath);

const key = (o: Observation) => `${o.pattern} / ${o.tool}`;
const summary = (o?: Observation) =>
  o ? `${o.exposed ? (o.named ? "노출(이름)" : "노출(텍스트)") : "숨김"}${o.marked ? " [aria-hidden]" : ""}, ${o.click}` : "없음";
const old = new Map(before.observations.map((o) => [key(o), o]));

const changed = after.observations.filter((o) => summary(old.get(key(o))) !== summary(o));

const v = (r: Layer1Result) => `Playwright MCP ${r.versions.playwrightMcp}, DevTools MCP ${r.versions.chromeDevtoolsMcp}, Chrome ${r.versions.chrome}`;
console.log(`### 1층 매트릭스 비교\n\n- 이전: ${v(before)}\n- 이번: ${v(after)}\n`);
if (changed.length === 0) {
  console.log("달라진 칸 없음");
} else {
  console.log("| 패턴 / 도구 | 이전 | 이번 |\n| --- | --- | --- |");
  for (const o of changed) console.log(`| ${key(o)} | ${summary(old.get(key(o)))} | ${summary(o)} |`);
}
