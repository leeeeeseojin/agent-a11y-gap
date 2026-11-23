// 에이전트에게 붙일 브라우저 MCP와 도구 권한. 두 실행기가 같은 목록을 써야 모델 차이만 남는다.
import { devtoolsMcpArgs, playwrightMcpArgs } from "../../probe/lib/mcp.js";
import type { BrowserServer } from "./types.js";

/**
 * 사람이 화면에서 할 수 있는 조작만 허용한다. IntentGuard src/audit/antigravity.ts의 목록을 그대로 가져왔다.
 * Antigravity CLI는 허용도 거부도 안 된 도구를 부르면 헤드리스 세션이 통째로 끝나므로,
 * Playwright MCP 0.0.86의 도구 25개를 두 목록에 빠짐없이 나눠 넣었다.
 */
const PLAYWRIGHT_ALLOWED = [
  "navigate", "navigate_back", "snapshot", "find", "click", "type", "fill_form",
  "select_option", "press_key", "hover", "drag", "handle_dialog", "wait_for", "tabs", "resize", "console_messages",
].map((t) => `browser_${t}`);

/** 페이지 안에서 코드를 돌리거나 네트워크를 엿보는 도구. 화면을 거치지 않고 DOM을 만질 수 있어서 막는다 */
const PLAYWRIGHT_DENIED = [
  "evaluate", "run_code_unsafe", "file_upload", "drop", "close", "network_request", "network_requests", "take_screenshot", "emulate_media",
].map((t) => `browser_${t}`);

export function browserServer(kind: "playwright" | "devtools"): BrowserServer {
  if (kind === "devtools") {
    return {
      name: "chrome-devtools",
      command: process.execPath,
      args: devtoolsMcpArgs(),
      // DevTools MCP는 전체 도구 목록을 정리해 두지 않아서 막을 것만 적는다. 그래서 Antigravity로는 돌릴 수 없다
      allowed: null,
      denied: ["evaluate_script", "take_screenshot", "list_network_requests", "get_network_request"],
    };
  }
  return {
    name: "playwright",
    command: process.execPath,
    args: [...playwrightMcpArgs(), "--image-responses", "omit"],
    allowed: PLAYWRIGHT_ALLOWED,
    denied: PLAYWRIGHT_DENIED,
  };
}
