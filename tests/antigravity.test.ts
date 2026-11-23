import { describe, expect, it } from "vitest";
import { parseAgyStream } from "../bench/agents/antigravity.js";
import { invalidReason } from "../bench/tasks.js";

// agy --output-format stream-json의 줄 모양. IntentGuard tests/audit.test.ts에서 쓰던 형태를 따랐다
const SERVER = "agent-a11y-gap-browser_playwright";
const tool = (tool_name: string, state: string, parameters: object, output = "ok") =>
  JSON.stringify({ step_update: { step_type: "tool", tool_name, state, tool_info: { parameters, output } } });
const click = (output = "ok") => tool("call_mcp_tool", "DONE", { ServerName: SERVER, ToolName: "browser_click", Arguments: { target: "e4" } }, output);
const response = JSON.stringify({ step_update: { step_type: "agent_response", state: "DONE" } });
const result = (text: string, status = "SUCCESS") => JSON.stringify({ result: { status, response: text } });

describe("Antigravity 출력 해석", () => {
  it("브라우저 호출과 응답 단계를 읽고 깨진 줄은 건너뛴다", () => {
    const run = parseAgyStream(["깨진 줄", JSON.stringify({ init: { model: "gpt-oss-120b-medium" } }), response, click(), result("끝")], SERVER);
    expect(run).toMatchObject({
      exitReason: "completed",
      numTurns: 1,
      model: "gpt-oss-120b-medium",
      toolCalls: [{ name: "browser_click", input: { target: "e4" }, isError: false }],
      outsideTools: [],
    });
  });

  it("mcp_<서버>_<도구> 이름으로 직접 부른 호출도 브라우저 호출로 센다", () => {
    // agy 1.5.14에서 Gemini가 call_mcp_tool 대신 이 모양으로 불렀다
    const direct = tool(`mcp_${SERVER}_browser_click`, "DONE", { target: "e4" });
    const run = parseAgyStream([direct], SERVER);
    expect(run.toolCalls).toMatchObject([{ name: "browser_click", input: { target: "e4" } }]);
    expect(run.outsideTools).toEqual([]);
    // 다른 서버 이름이 앞에 붙은 경우는 브라우저 밖 도구다
    expect(parseAgyStream([tool("mcp_github_search", "DONE", {})], SERVER).outsideTools).toEqual(["mcp_github_search"]);
  });

  it("정상 응답에 담긴 Playwright 오류도 실패한 호출로 센다", () => {
    // inert 배경 버튼을 누르면 이렇게 시간 초과가 본문으로 돌아온다
    const run = parseAgyStream([click("### Error\nTimeoutError: locator.click: Timeout 5000ms exceeded.\n  - element is inert")], SERVER);
    expect(run.toolCalls[0]?.isError).toBe(true);
  });

  it("다른 서버의 도구나 내장 도구가 성공하면 브라우저 밖 도구로 남긴다", () => {
    expect(parseAgyStream([tool("run_command", "DONE", {})], SERVER).outsideTools).toEqual(["run_command"]);
    expect(parseAgyStream([tool("call_mcp_tool", "DONE", { ServerName: "github", ToolName: "x" })], SERVER).outsideTools).toEqual(["call_mcp_tool"]);
    // 권한으로 거부된 시도는 실제로 쓰지 못했으므로 무효가 아니다
    expect(parseAgyStream([tool("run_command", "ERROR", {})], SERVER).outsideTools).toEqual([]);
  });
});

describe("무효 실행", () => {
  it("브라우저 밖 도구 사용과 실행기 오류는 무효, 시간 초과는 실패로 남긴다", () => {
    expect(invalidReason({ outsideTools: ["run_command"], exitReason: "completed" })).toMatch(/브라우저 밖/);
    expect(invalidReason({ outsideTools: [], exitReason: "error" })).toMatch(/실행기 오류/);
    expect(invalidReason({ outsideTools: [], exitReason: "timeout" })).toBeNull();
    expect(invalidReason({ outsideTools: [], exitReason: "completed" })).toBeNull();
  });
});
