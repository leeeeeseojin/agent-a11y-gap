// 3층: 모달 구현 A~E를 사람 기준과 에이전트 기준으로 한 표에 놓는다.
// E는 B에 [aria-hidden] 표시를 살리는 우회(docs/aria-hidden-mark.md)를 더한 것이다.
// 여기서 재는 에이전트 기준은 LLM 없이 정해지는 부분이다. 시트가 열린 상태에서
//   - 각 MCP 스냅샷에 배경 "경기 시작"이 보이는가, 그 ref를 누르면 경기가 실제로 시작되는가
//   - "저장"이라는 이름의 버튼이 몇 개로 보이는가 (배경의 로스터 저장과 시트의 설정 저장)
// 실제 에이전트의 성공률은 2층(bench/)에서 잰다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectVersions, launchChrome, versionKey } from "./lib/env.js";
import { devtoolsMcpArgs, playwrightMcpArgs, withMcp } from "./lib/mcp.js";
import { IMPLS, measureHuman, type HumanChecks, type Impl } from "./human.js";
import { startServer, type CaseServer } from "./serve.js";
import { readDevtoolsMcp } from "./tools/devtools-mcp.js";
import { readPlaywrightMcp } from "./tools/playwright-mcp.js";
import type { ProbeTarget, Reading, Tool } from "./types.js";

interface AgentView extends Reading {
  /** 스냅샷에서 "저장"이 들어간 버튼 줄 수. 2 이상이면 에이전트가 둘 중 하나를 골라야 한다 */
  saveButtons: number;
}

interface DesignRow {
  impl: Impl;
  human: HumanChecks;
  agent: AgentView[];
}

const server = await startServer(Number(process.env.PROBE_PORT ?? 4310));
const browser = await launchChrome();
const versions = collectVersions(browser);

/** 시트가 열린 채로 시작하는 페이지. 경기가 시작됐는지는 페이지가 서버에 올린 상태로 본다. */
function modalTarget(s: CaseServer, impl: Impl, run: string, onSnapshot: (tool: Tool, text: string) => void): ProbeTarget {
  return {
    url: `${s.url}/modal/?impl=${impl}&open=1&run=${run}`,
    name: "경기 시작",
    wasClicked: async (waitMs = 800) => {
      const until = Date.now() + waitMs;
      while (Date.now() < until) {
        if ((s.state.get(run) as { started?: boolean } | undefined)?.started) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    },
    saveSnapshot: onSnapshot,
  };
}

const countSaveButtons = (snapshot: string) => snapshot.split(/\r?\n/).filter((l) => /\bbutton\b/.test(l) && l.includes("저장")).length;

const rows: DesignRow[] = [];
try {
  for (const impl of IMPLS) {
    const page = await browser.newPage();
    const human = await measureHuman(page, server.url, impl);
    await page.close();

    const agent: AgentView[] = [];
    for (const [tool, args, read] of [
      ["pw-mcp-snapshot", playwrightMcpArgs(), readPlaywrightMcp],
      ["devtools-mcp-snapshot", devtoolsMcpArgs(), readDevtoolsMcp],
    ] as const) {
      let snapshot = "";
      const target = modalTarget(server, impl, `layer3-${impl}-${tool}`, (_, text) => (snapshot = text));
      const r = await withMcp([...args], (mcp) => read(mcp, target));
      agent.push({ ...r, saveButtons: countSaveButtons(snapshot) });
    }

    rows.push({ impl, human, agent });
    const h = Object.values(human).every(Boolean) ? "사람 기준 통과" : "사람 기준 미달";
    console.log(`${impl}  ${h.padEnd(10)} ${agent.map((a) => `${a.tool}: ${a.exposed ? "배경 노출" : "배경 숨김"}${a.marked ? "[aria-hidden]" : ""}/${a.click}/저장 ${a.saveButtons}개`).join("  ")}`);
  }
} finally {
  await browser.close();
  await server.close();
}

const out = path.resolve("runs/layer3", versionKey(versions));
mkdirSync(out, { recursive: true });
const json = JSON.stringify({ collectedAt: new Date().toISOString(), versions, rows }, null, 2) + "\n";
writeFileSync(path.join(out, "design.json"), json);
writeFileSync(path.resolve("runs/layer3/latest.json"), json);
console.log(`\n저장: ${path.relative(process.cwd(), out)}/design.json`);
