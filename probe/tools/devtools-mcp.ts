// Chrome DevTools MCP는 같은 Chrome을 다른 MCP로 읽으면 결과가 달라지는지 보기 위한 비교 대상이다.
// take_snapshot의 uid를 click으로 누른다. 페이지는 pageId로 지정해야 해서 list_pages로 먼저 찾는다.
import type { McpSession } from "../lib/mcp.js";
import { classifyClickError, errorLine, firstLine, parseDevtoolsSnapshot, reading } from "../parse.js";
import type { ProbeTarget, Reading } from "../types.js";

export async function readDevtoolsMcp(mcp: McpSession, target: ProbeTarget): Promise<Reading> {
  await mcp.call("navigate_page", { pageId: await selectedPageId(mcp), type: "url", url: target.url });
  const pageId = await selectedPageId(mcp);
  const snapshot = await mcp.call("take_snapshot", { pageId });
  target.saveSnapshot?.("devtools-mcp-snapshot", snapshot.text);

  const found = parseDevtoolsSnapshot(snapshot.text, target.name);
  if (!found.ref) return reading("devtools-mcp-snapshot", found, "not-attempted");

  const res = await mcp.call("click", { pageId, uid: found.ref });
  if (await target.wasClicked()) return reading("devtools-mcp-snapshot", found, "clicked");
  if (res.isError) return reading("devtools-mcp-snapshot", found, classifyClickError(res.text), errorLine(res.text));
  // 오버레이로 가린 버튼에서 "Successfully clicked"라고 답하지만 실제로는 눌리지 않는 경우가 여기로 온다.
  // 에이전트는 이 응답만 보고 눌렀다고 믿게 되므로 응답 문장을 그대로 남긴다.
  return reading("devtools-mcp-snapshot", found, "no-effect", firstLine(res.text));
}

async function selectedPageId(mcp: McpSession): Promise<number> {
  const res = await mcp.call("list_pages", {});
  // 목록은 "1: http://... [selected]" 형식이다
  const line = res.text.split(/\r?\n/).find((l) => l.includes("selected")) ?? res.text;
  return Number(line.match(/(\d+):/)?.[1] ?? 1);
}
