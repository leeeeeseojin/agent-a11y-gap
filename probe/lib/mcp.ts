// MCP 서버를 stdio로 띄우고 도구를 부르는 얇은 클라이언트다.
// 에이전트가 쓰는 것과 같은 서버를 LLM 없이 직접 호출해서, 에이전트가 "받는 화면"을 그대로 본다.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const TMP = path.resolve(".tmp");

// 두 패키지 모두 package.json의 exports에 CLI 경로가 없어 require.resolve로는 못 찾는다
export const pkgDir = (name: string) => path.resolve("node_modules", name);

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpSession {
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  /** 서버가 알려 주는 도구 목록. 2층 API 실행기가 모델에게 넘길 도구 정의를 여기서 만든다 */
  listTools(): Promise<McpTool[]>;
  close(): Promise<void>;
}

export async function openMcp(args: string[]): Promise<McpSession> {
  const client = new Client({ name: "agent-a11y-gap-probe", version: "0.1.0" });
  const env = { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1" } as Record<string, string>;
  await client.connect(new StdioClientTransport({ command: process.execPath, args, stderr: "ignore", env }));

  return {
    async call(name, input) {
      try {
        const result = await client.callTool({ name, arguments: input });
        const content = (result.content ?? []) as { text?: string }[];
        return { text: content.map((c) => c.text ?? "").join("\n"), isError: !!result.isError };
      } catch (e) {
        // 도구 호출 자체가 실패해도(시간 초과 등) 결과로 기록해야 하므로 던지지 않는다
        return { text: String(e), isError: true };
      }
    },
    async listTools() {
      return (await client.listTools()).tools as McpTool[];
    },
    close: () => client.close(),
  };
}

/** 2층에서 에이전트에게 붙일 때도 같은 옵션을 쓴다. --isolated는 실행마다 새 프로필을 쓴다. */
export function playwrightMcpArgs(): string[] {
  const out = path.join(TMP, "pw-mcp");
  mkdirSync(out, { recursive: true });
  return [path.join(pkgDir("@playwright/mcp"), "cli.js"), "--headless", "--isolated", "--browser", "chrome", "--output-dir", out];
}

export function devtoolsMcpArgs(): string[] {
  const cli = path.join(pkgDir("chrome-devtools-mcp"), "out/Default/gen/src/bin/chrome-devtools-mcp.js");
  return [cli, "--headless", "--isolated", "--usageStatistics=false"];
}

/** MCP 서버 하나를 띄워 일을 시키고 반드시 닫는다. */
export async function withMcp<T>(args: string[], fn: (mcp: McpSession) => Promise<T>): Promise<T> {
  const mcp = await openMcp(args);
  try {
    return await fn(mcp);
  } finally {
    await mcp.close();
  }
}
