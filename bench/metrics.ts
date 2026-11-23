// 도구 호출 기록에서 세는 2층 지표. 채점(tasks.ts)과 달리 성공 여부가 아니라 실패 과정을 본다.
import { classifyClickError } from "../probe/parse.js";
import type { ToolCall } from "./agents/types.js";

/**
 * 배경 요소를 누르려다 막힌 흔적. 1층과 같은 분류 함수를 써서 가로막힘과 시간 초과만 센다.
 * inert 배경은 "element is inert"로 기다리다 시간 초과가 나므로 timeout 쪽으로 들어간다.
 */
export function blockedClicks(calls: ToolCall[]): number {
  return calls.filter((c) => {
    if (!/click/i.test(c.name) || !c.isError) return false;
    const kind = classifyClickError(c.resultPreview);
    return kind === "intercepted" || kind === "timeout";
  }).length;
}

/**
 * 대상이 여러 요소로 풀려 거절된 호출. 스냅샷 ref 대신 `text=저장` 같은 로케이터로 고른 에이전트에게서 나온다.
 * 시험 실행에서 GPT-OSS는 배경과 시트에 모두 있는 "저장" 때문에 이 오류를 받고 nth로 하나를 골랐다.
 *
 * 시트 안에도 같은 이름이 있어서(공격 작전과 투수 교체의 "코치에게") 배경과 상관없는 경우도 같이 세진다.
 * 그래서 이 값은 절대 수치보다 구현끼리 비교해서 읽는다. 배경을 내리는 D에서 줄어든 만큼이 배경 몫이다.
 */
export function ambiguousTargets(calls: ToolCall[]): number {
  return calls.filter((c) => c.isError && /strict mode violation/i.test(c.resultPreview)).length;
}
