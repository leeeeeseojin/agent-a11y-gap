// Playwright MCP는 IntentGuard에서 에이전트가 실제로 쓴 경로다.
// browser_snapshot이 대상 버튼을 보여주면, 에이전트가 할 법한 대로 그 ref를 browser_click으로 누른다.
import type { McpSession } from "../lib/mcp.js";
import { classifyClickError, errorLine, firstLine, parsePlaywrightSnapshot, reading } from "../parse.js";
import type { ProbeTarget, Reading } from "../types.js";

export async function readPlaywrightMcp(mcp: McpSession, target: ProbeTarget): Promise<Reading> {
  await mcp.call("browser_navigate", { url: target.url });
  const snapshot = await mcp.call("browser_snapshot", {});
  target.saveSnapshot?.("pw-mcp-snapshot", snapshot.text);

  const found = parsePlaywrightSnapshot(snapshot.text, target.name);
  if (!found.ref) return reading("pw-mcp-snapshot", found, "not-attempted");

  const res = await mcp.call("browser_click", { target: found.ref, element: `${target.name} button` });
  if (await target.wasClicked()) return reading("pw-mcp-snapshot", found, "clicked");
  if (res.isError) return reading("pw-mcp-snapshot", found, classifyClickError(res.text), errorLine(res.text));
  return reading("pw-mcp-snapshot", found, "no-effect", firstLine(res.text));
}
