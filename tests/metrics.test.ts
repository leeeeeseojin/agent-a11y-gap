import { describe, expect, it } from "vitest";
import type { ToolCall } from "../bench/agents/types.js";
import { ambiguousTargets, blockedClicks } from "../bench/metrics.js";

const call = (name: string, resultPreview: string, isError = true): ToolCall => ({ name, input: {}, isError, resultPreview });

// 오류 문장은 시험 실행 기록에서 줄여 가져왔다
const strictSave = "### Error\nError: strict mode violation: locator('text=저장') resolved to 2 elements:";
const inertTimeout = "### Error\nTimeoutError: locator.click: Timeout 5000ms exceeded.\n  - element is inert";
const intercepted = "### Error\n<div class=\"backdrop\"></div> intercepts pointer events";

describe("막힌 클릭", () => {
  it("가로막힘과 inert 시간 초과만 센다", () => {
    expect(blockedClicks([call("browser_click", inertTimeout), call("mcp__playwright__browser_click", intercepted)])).toBe(2);
  });

  it("대상 중복, 성공한 클릭, 클릭이 아닌 도구는 세지 않는다", () => {
    expect(blockedClicks([call("browser_click", strictSave), call("browser_click", "ok", false), call("browser_type", inertTimeout)])).toBe(0);
  });
});

describe("대상 중복", () => {
  it("strict mode violation으로 거절된 호출을 도구와 상관없이 센다", () => {
    expect(ambiguousTargets([call("browser_click", strictSave), call("browser_hover", strictSave), call("browser_click", inertTimeout)])).toBe(2);
  });

  it("오류가 아닌 응답에 같은 문장이 있어도 세지 않는다", () => {
    expect(ambiguousTargets([call("browser_snapshot", "strict mode violation", false)])).toBe(0);
  });
});
