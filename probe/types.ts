export type Tool = "cdp-ax-tree" | "pw-get-by-role" | "pw-mcp-snapshot" | "devtools-mcp-snapshot";

/**
 * 도구가 ref를 줬을 때 그 ref를 실제로 눌러 본 결과.
 * - clicked: 서버에 클릭이 기록됨 (사람에게 숨겨진 버튼이 눌렸다는 뜻)
 * - intercepted: 다른 요소(시트 배경 등)가 클릭을 가로챔
 * - timeout: 눌 수 있는 상태가 되기를 기다리다 시간 초과
 * - no-effect: 도구는 성공이라고 답했지만 클릭이 기록되지 않음
 * - stale-ref: 도구가 방금 준 ref를 다시 찾지 못함
 * - error: 그 밖의 오류
 * - not-attempted: 노출되지 않았거나 ref가 없어 시도하지 않음
 */
export type ClickOutcome = "clicked" | "intercepted" | "timeout" | "no-effect" | "stale-ref" | "error" | "not-attempted";

export interface Observation {
  pattern: string;
  tool: Tool;
  /** TARGET 텍스트가 도구 출력 어디든 나타나는가 */
  exposed: boolean;
  /** button 역할에 접근성 이름 TARGET이 붙어 있는가 (이름 없이 텍스트만 남으면 false) */
  named: boolean;
  /** 도구가 그 요소를 가리키는 클릭용 ref/uid를 줬는가 */
  ref: string | null;
  click: ClickOutcome;
  /** 판정 근거가 된 도구 출력 한 줄 또는 오류 요약 */
  evidence: string;
}

export interface Versions {
  playwrightMcp: string;
  chromeDevtoolsMcp: string;
  playwright: string;
  chrome: string;
  node: string;
  os: string;
}

export interface Layer1Result {
  collectedAt: string;
  versions: Versions;
  observations: Observation[];
}
