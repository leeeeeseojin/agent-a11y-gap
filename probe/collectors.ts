// 패턴 페이지 하나를 도구 하나로 읽고, TARGET이 보이면 실제로 눌러 본다.
// 브라우저는 모두 설치된 Chrome 안정판(headless)으로 맞춘다. 도구 차이만 남기기 위해서다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium, type Browser } from "playwright";
import type { CaseServer } from "./serve.js";
import { classifyClickError, parseDevtoolsSnapshot, parsePlaywrightSnapshot, type Found } from "./parse.js";
import type { ClickOutcome, Observation, Tool } from "./types.js";

export const TMP = path.resolve(".tmp");

/** exports 필드 때문에 require.resolve로 못 찾는 CLI 경로를 node_modules에서 직접 찾는다 */
export const pkgDir = (name: string) => path.resolve("node_modules", name);

/** 클릭이 서버에 기록되기까지 기다리는 시간. sendBeacon은 비동기라 잠깐 기다린다. */
async function waitForHit(server: CaseServer, pattern: string, ms = 800): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (server.hits.some((h) => h.case === pattern && h.el === "TARGET")) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

function observation(pattern: string, tool: Tool, found: Found, click: ClickOutcome, extra = ""): Observation {
  return {
    pattern,
    tool,
    exposed: found.exposed,
    named: found.named,
    ref: found.ref,
    click,
    evidence: [found.line, extra].filter(Boolean).join(" | ").slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// MCP 공통: stdio로 서버를 띄우고 도구를 부른다
// ---------------------------------------------------------------------------

export interface McpSession {
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  version: string;
  close(): Promise<void>;
}

export async function openMcp(command: string, args: string[]): Promise<McpSession> {
  const client = new Client({ name: "agent-a11y-gap-probe", version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command, args, stderr: "ignore", env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1" } as Record<string, string> }));
  return {
    version: client.getServerVersion()?.version ?? "?",
    async call(name, a) {
      try {
        const r = await client.callTool({ name, arguments: a });
        return { text: textOf(r), isError: !!r.isError };
      } catch (e) {
        return { text: String(e), isError: true };
      }
    },
    close: () => client.close(),
  };
}

export function playwrightMcpArgs(): string[] {
  const out = path.join(TMP, "pw-mcp");
  mkdirSync(out, { recursive: true });
  // --isolated: 매 실행 새 프로필. 에이전트 실행(2층)과 같은 옵션을 쓴다
  return [path.join(pkgDir("@playwright/mcp"), "cli.js"), "--headless", "--isolated", "--browser", "chrome", "--output-dir", out];
}

export function devtoolsMcpArgs(): string[] {
  return [path.join(pkgDir("chrome-devtools-mcp"), "out/Default/gen/src/bin/chrome-devtools-mcp.js"), "--headless", "--isolated", "--usageStatistics=false"];
}

/** Playwright MCP: browser_snapshot을 읽고, ref가 있으면 browser_click으로 누른다. */
export async function probePlaywrightMcp(mcp: McpSession, server: CaseServer, pattern: string, snapshotDir: string): Promise<Observation> {
  await mcp.call("browser_navigate", { url: `${server.url}/patterns/${pattern}.html` });
  const snap = await mcp.call("browser_snapshot", {});
  writeSnapshot(snapshotDir, "pw-mcp-snapshot", pattern, snap.text);
  const found = parsePlaywrightSnapshot(snap.text);
  if (!found.ref) return observation(pattern, "pw-mcp-snapshot", found, "not-attempted");
  const r = await mcp.call("browser_click", { target: found.ref, element: "TARGET button" });
  if (await waitForHit(server, pattern)) return observation(pattern, "pw-mcp-snapshot", found, "clicked");
  if (r.isError) return observation(pattern, "pw-mcp-snapshot", found, classifyClickError(r.text), firstErrorLine(r.text));
  return observation(pattern, "pw-mcp-snapshot", found, "no-effect", firstLine(r.text));
}

/** Chrome DevTools MCP: take_snapshot을 읽고, uid가 있으면 click으로 누른다. */
export async function probeDevtoolsMcp(mcp: McpSession, server: CaseServer, pattern: string, snapshotDir: string): Promise<Observation> {
  await mcp.call("navigate_page", { pageId: await currentPageId(mcp), type: "url", url: `${server.url}/patterns/${pattern}.html` });
  const pageId = await currentPageId(mcp);
  const snap = await mcp.call("take_snapshot", { pageId });
  writeSnapshot(snapshotDir, "devtools-mcp-snapshot", pattern, snap.text);
  const found = parseDevtoolsSnapshot(snap.text);
  if (!found.ref) return observation(pattern, "devtools-mcp-snapshot", found, "not-attempted");
  const r = await mcp.call("click", { pageId, uid: found.ref });
  if (await waitForHit(server, pattern)) return observation(pattern, "devtools-mcp-snapshot", found, "clicked");
  if (r.isError) return observation(pattern, "devtools-mcp-snapshot", found, classifyClickError(r.text), firstErrorLine(r.text));
  // 도구는 성공이라고 답했는데 서버에는 클릭이 없다. 에이전트가 "눌렀다"고 믿게 되는 경우라 응답 문장을 남긴다
  return observation(pattern, "devtools-mcp-snapshot", found, "no-effect", firstLine(r.text));
}

async function currentPageId(mcp: McpSession): Promise<number> {
  const r = await mcp.call("list_pages", {});
  // 예: "1: http://... [selected]" 형식에서 선택된 페이지 번호를 읽는다
  const selected = r.text.split(/\r?\n/).find((l) => /selected/.test(l)) ?? r.text;
  return Number(selected.match(/(\d+):/)?.[1] ?? 1);
}

/** 오류 응답에서 원인이 드러나는 한 줄. "### Error" 같은 머리글은 건너뛴다 */
function firstErrorLine(text: string): string {
  const lines = meaningfulLines(text);
  const pick = lines.find((l) => /intercepts pointer events/i.test(l)) ?? lines.find((l) => /error|timeout|not found|did not/i.test(l)) ?? lines[0] ?? "";
  return pick.slice(0, 200);
}

function firstLine(text: string): string {
  return (meaningfulLines(text)[0] ?? "").slice(0, 200);
}

function meaningfulLines(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "") // Playwright 오류의 터미널 색 코드
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("```"));
}

function writeSnapshot(dir: string, tool: Tool, pattern: string, text: string) {
  const d = path.join(dir, tool);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${pattern}.txt`), text.replace(/\r\n/g, "\n"));
}

// ---------------------------------------------------------------------------
// 기준선: 같은 Chrome을 Playwright로 직접 띄워 CDP 전체 접근성 트리와 getByRole을 본다
// ---------------------------------------------------------------------------

export async function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
}

/**
 * CDP Accessibility.getFullAXTree: 스크린 리더가 받는 것과 같은 Chrome의 접근성 트리.
 * 이 프로젝트에서 "사람 기준"은 이 트리에서 ignored가 아닌가로 정한다.
 */
export async function probeCdp(browser: Browser, server: CaseServer, pattern: string): Promise<Observation> {
  const page = await browser.newPage();
  try {
    await page.goto(`${server.url}/patterns/${pattern}.html`);
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };
    const visible = nodes.filter((n) => !n.ignored && n.name?.value?.includes("TARGET"));
    const button = visible.find((n) => n.role?.value === "button" && n.name?.value === "TARGET");
    const node = button ?? visible[0];
    const found: Found = node
      ? { exposed: true, named: !!button, ref: null, line: `${node.role?.value} "${node.name?.value}"` }
      : { exposed: false, named: false, ref: null, line: "" };
    // CDP 트리는 클릭 ref를 주지 않으므로 클릭은 재지 않는다
    return observation(pattern, "cdp-ax-tree", found, "not-attempted");
  } finally {
    await page.close();
  }
}

/** Playwright getByRole: 사람 기준 E2E가 쓰는 로케이터. 찾으면 클릭까지 해 본다. */
export async function probeGetByRole(browser: Browser, server: CaseServer, pattern: string): Promise<Observation> {
  const page = await browser.newPage();
  try {
    await page.goto(`${server.url}/patterns/${pattern}.html`);
    const loc = page.getByRole("button", { name: "TARGET", exact: true });
    const count = await loc.count();
    const found: Found = { exposed: count > 0, named: count > 0, ref: count > 0 ? "getByRole" : null, line: count > 0 ? `getByRole('button', { name: 'TARGET' }) → ${count}개` : "" };
    if (count === 0) return observation(pattern, "pw-get-by-role", found, "not-attempted");
    try {
      await loc.first().click({ timeout: 3000 });
    } catch (e) {
      if (await waitForHit(server, pattern)) return observation(pattern, "pw-get-by-role", found, "clicked");
      return observation(pattern, "pw-get-by-role", found, classifyClickError(String(e)), firstErrorLine(String(e)));
    }
    return observation(pattern, "pw-get-by-role", found, (await waitForHit(server, pattern)) ? "clicked" : "no-effect");
  } finally {
    await page.close();
  }
}
