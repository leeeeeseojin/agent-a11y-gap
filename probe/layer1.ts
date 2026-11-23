// 1층: 숨김 패턴 14종 × 도구 4종. LLM 없이 돌려서 매번 같은 결과가 나와야 한다.
// 결과는 runs/layer1/<버전 조합>/results.json에 남기고 runs/layer1/latest.json에도 복사한다.
//
//   pnpm probe                      전체 실행 후 저장
//   pnpm probe inert-ancestor ...   일부 패턴만 확인 (저장하지 않음)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PATTERNS } from "../cases/patterns.js";
import { clickWatcher, collectVersions, launchChrome, snapshotWriter, versionKey } from "./lib/env.js";
import { devtoolsMcpArgs, playwrightMcpArgs, withMcp } from "./lib/mcp.js";
import { startServer } from "./serve.js";
import { readCdpTree } from "./tools/cdp-ax-tree.js";
import { readDevtoolsMcp } from "./tools/devtools-mcp.js";
import { readGetByRole } from "./tools/get-by-role.js";
import { readPlaywrightMcp } from "./tools/playwright-mcp.js";
import type { Layer1Result, Observation, ProbeTarget, Reading } from "./types.js";

const only = process.argv.slice(2);
const patterns = only.length ? PATTERNS.filter((p) => only.includes(p.id)) : PATTERNS;

// 포트를 고정해 스냅샷에 찍히는 URL이 실행마다 바뀌지 않게 한다. 버전 간 diff를 읽기 쉽게 하기 위해서다.
const server = await startServer(Number(process.env.PROBE_PORT ?? 4310));
const browser = await launchChrome();
const versions = collectVersions(browser);
const outDir = path.resolve("runs/layer1", versionKey(versions));

const observations: Observation[] = [];

/** 도구 하나로 패턴 하나를 읽는다. 매번 클릭 기록을 비우고 시작한다. */
async function observe(pattern: string, read: (target: ProbeTarget) => Promise<Reading>) {
  const target: ProbeTarget = {
    url: `${server.url}/patterns/${pattern}.html`,
    name: "TARGET",
    wasClicked: clickWatcher(server, pattern, "TARGET"),
    saveSnapshot: snapshotWriter(path.join(outDir, "snapshots"), pattern),
  };
  const r = { pattern, ...(await read(target)) };
  observations.push(r);
  const seen = !r.exposed ? "숨김" : r.named ? "노출(이름)" : "노출(텍스트)";
  console.log(`${pattern.padEnd(26)} ${r.tool.padEnd(22)} ${seen.padEnd(10)} ${r.click}`);
}

try {
  for (const p of patterns) await observe(p.id, (t) => readCdpTree(browser, t));
  for (const p of patterns) await observe(p.id, (t) => readGetByRole(browser, t));
  // MCP 서버는 패턴마다 새로 띄운다. 앞 패턴의 페이지 상태나 ref 번호가 섞이지 않게 하기 위해서다.
  for (const p of patterns) await observe(p.id, (t) => withMcp(playwrightMcpArgs(), (mcp) => readPlaywrightMcp(mcp, t)));
  for (const p of patterns) await observe(p.id, (t) => withMcp(devtoolsMcpArgs(), (mcp) => readDevtoolsMcp(mcp, t)));
} finally {
  await browser.close();
  await server.close();
}

if (only.length) {
  console.log("\n일부 패턴만 돌렸으므로 저장하지 않음");
} else {
  const result: Layer1Result = { collectedAt: new Date().toISOString(), versions, observations };
  const json = JSON.stringify(result, null, 2) + "\n";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "results.json"), json);
  writeFileSync(path.resolve("runs/layer1/latest.json"), json);
  console.log(`\n저장: ${path.relative(process.cwd(), outDir)}/results.json`);
}
