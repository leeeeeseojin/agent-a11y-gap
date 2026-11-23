// 에이전트 실행기(Claude Code, Antigravity CLI)가 같이 쓰는 입력과 출력.
// run.ts는 어느 실행기인지 몰라도 같은 방식으로 채점할 수 있어야 한다.

export interface ToolCall {
  name: string;
  input: unknown;
  isError: boolean;
  /** 결과 앞부분. 배경 클릭 시도와 오류 문장을 세는 데 쓴다 */
  resultPreview: string;
}

/** 에이전트에게 붙이는 브라우저 MCP 서버 하나와 그 도구 권한 */
export interface BrowserServer {
  /** MCP 설정에 들어가는 서버 이름 */
  name: string;
  command: string;
  args: string[];
  /** 허용할 도구. null이면 막은 것만 빼고 서버 도구를 모두 허용한다 */
  allowed: string[] | null;
  denied: string[];
}

export interface AgentInput {
  model: string;
  prompt: string;
  timeoutMs: number;
  rawLogPath: string;
  browser: BrowserServer;
}

export interface AgentRun {
  durationMs: number;
  exitReason: "completed" | "timeout" | "error";
  /**
   * 모델 응답 횟수. Claude Code는 num_turns, Antigravity는 끝난 응답 단계 수로 세서
   * 실행기끼리 직접 비교하면 안 된다. 같은 실행기 안에서 구현끼리 비교할 때만 쓴다.
   */
  numTurns: number;
  toolCalls: ToolCall[];
  finalAnswer: string;
  /** 실행기가 스스로 보고한 모델 */
  model: string;
  /** 브라우저 MCP가 아닌 도구로 성공한 호출. 하나라도 있으면 그 실행은 무효다 */
  outsideTools: string[];
  /** 모델 서버 용량 부족처럼, 에이전트와 상관없이 실행기가 끝난 일시 오류. 같은 조건으로 다시 돌린다 */
  retryable: boolean;
}
