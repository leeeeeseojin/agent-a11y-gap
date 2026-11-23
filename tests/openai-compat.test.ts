import { describe, expect, it } from "vitest";
import { browserServer } from "../bench/agents/browser.js";
import { httpLimit, toOpenAiTools } from "../bench/agents/openai-compat.js";

const schema = { type: "object", properties: {} };

describe("API 실행기 도구 정의", () => {
  it("허용 목록에 있는 도구만 모델에게 넘긴다", () => {
    const tools = toOpenAiTools(
      [
        { name: "browser_click", description: "Click", inputSchema: schema },
        // 페이지 안에서 JS를 돌리는 도구는 막혀 있어서 정의에서 빠진다
        { name: "browser_evaluate", inputSchema: schema },
        // 목록에 없는 새 도구도 빠진다. 버전이 바뀌어 도구가 늘어도 권한이 저절로 넓어지지 않는다
        { name: "browser_new_tool", inputSchema: schema },
      ],
      browserServer("playwright"),
    );
    expect(tools.map((t) => t.function.name)).toEqual(["browser_click"]);
    expect(tools[0].function).toMatchObject({ description: "Click", parameters: schema });
  });

  it("허용 목록이 없는 서버(DevTools MCP)는 돌리지 않는다", () => {
    expect(() => toOpenAiTools([], browserServer("devtools"))).toThrow();
  });
});

describe("API 오류", () => {
  it("크레딧 부족과 키 만료는 멈추고, 요청 제한과 서버 오류는 다시 시도한다", () => {
    expect(httpLimit(402)).toBe("quota");
    expect(httpLimit(401)).toBe("quota");
    expect(httpLimit(403)).toBe("quota");
    expect(httpLimit(429)).toBe("retry");
    expect(httpLimit(503)).toBe("retry");
    expect(httpLimit(400)).toBeNull();
  });
});
