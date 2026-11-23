// 1층: 패턴 14종 × 도구 4종을 LLM 없이 돌려 결정적인 매트릭스를 만든다.
// 결과는 runs/layer1/<버전 조합>/에 남기고, 같은 내용을 runs/layer1/latest.json에 복사한다.
// 버전 조합을 폴더 이름에 넣는 이유: 결과는 "이 버전에서의 값"이라 버전이 바뀌면 따로 쌓아 비교해야 한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATTERNS } from "../cases/patterns.js";
import { startServer } from "./serve.js";
import {
  devtoolsMcpArgs,
  pkgDir,
  launchChrome,
  openMcp,
  playwrightMcpArgs,
  probeCdp,
  probeDevtoolsMcp,
  probeGetByRole,
  probePlaywrightMcp,
} from "./collectors.js";
import type { Layer1Result, Observation } from "./types.js";

const pkgVersion = (name: string) => JSON.parse(readFileSync(path.join(pkgDir(name), "package.json"), "utf8")).version as string;

const only = process.argv.slice(2);
const patterns = only.length ? PATTERNS.filter((p) => only.includes(p.id)) : PATTERNS;

// 포트를 고정해 스냅샷에 찍히는 URL이 실행마다 바뀌지 않게 한다 (버전 간 diff를 읽기 쉽게)
const server = await startServer(Number(process.env.PROBE_PORT ?? 4310));
const browser = await launchChrome();
const chrome = browser.version();
const versions = {
  playwrightMcp: pkgVersion("@playwright/mcp"),
  chromeDevtoolsMcp: pkgVersion("chrome-devtools-mcp"),
  playwright: pkgVersion("playwright"),
  chrome,
  node: process.version,
  os: `${os.platform()} ${os.release()}`,
};
const key = `pw-mcp-${versions.playwrightMcp}__devtools-mcp-${versions.chromeDevtoolsMcp}__chrome-${chrome.split(".")[0]}`;
const outDir = path.resolve("runs/layer1", key);
const snapshotDir = path.join(outDir, "snapshots");
mkdirSync(outDir, { recursive: true });

const observations: Observation[] = [];
const log = (o: Observation) => {
  observations.push(o);
  const mark = o.exposed ? (o.named ? "노출(이름)" : "노출(텍스트)") : "숨김";
  console.log(`${o.pattern.padEnd(26)} ${o.tool.padEnd(22)} ${mark.padEnd(10)} ${o.click}`);
};

try {
  for (const p of patterns) log(await probeCdp(browser, server, p.id));
  for (const p of patterns) log(await probeGetByRole(browser, server, p.id));

  // MCP는 패턴마다 새로 띄운다. 이전 패턴의 페이지 상태나 ref 번호가 다음 결과에 섞이지 않게 하기 위해서다.
  for (const p of patterns) {
    const mcp = await openMcp(process.execPath, playwrightMcpArgs());
    try {
      log(await probePlaywrightMcp(mcp, server, p.id, snapshotDir));
    } finally {
      await mcp.close();
    }
  }
  for (const p of patterns) {
    const mcp = await openMcp(process.execPath, devtoolsMcpArgs());
    try {
      log(await probeDevtoolsMcp(mcp, server, p.id, snapshotDir));
    } finally {
      await mcp.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const result: Layer1Result = { collectedAt: new Date().toISOString(), versions, observations };
const json = JSON.stringify(result, null, 2) + "\n";
if (!only.length) {
  writeFileSync(path.join(outDir, "results.json"), json);
  writeFileSync(path.resolve("runs/layer1/latest.json"), json);
  console.log(`\n저장: runs/layer1/${key}/results.json`);
} else {
  console.log("\n일부 패턴만 돌렸으므로 저장하지 않음");
}
