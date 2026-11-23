import { describe, expect, it } from "vitest";
import { browserServer } from "../bench/agents/browser.js";
import { httpLimit, toOpenAiTools, withCache, type ChatMessage } from "../bench/agents/openai-compat.js";

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

describe("프롬프트 캐시", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "요청" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "browser_snapshot", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "스냅샷" },
  ];

  it("Anthropic 모델이면 마지막 메시지에만 캐시 표시를 붙이고 내용은 그대로 둔다", () => {
    const sent = withCache("anthropic/claude-sonnet-5.5", messages) as any[];
    expect(sent[2].content).toEqual([{ type: "text", text: "스냅샷", cache_control: { type: "ephemeral" } }]);
    expect(sent[0]).toEqual(messages[0]);
  });

  it("다른 모델의 요청은 바꾸지 않는다", () => {
    expect(withCache("openai/gpt-oss-120b", messages)).toBe(messages);
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
