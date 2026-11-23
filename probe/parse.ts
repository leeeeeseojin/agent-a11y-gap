// 도구마다 다른 스냅샷 텍스트에서 TARGET 버튼의 흔적을 찾는다.
// 같은 판정 규칙을 두 MCP에 똑같이 적용해야 도구 간 비교가 공정하다.

export interface Found {
  exposed: boolean;
  named: boolean;
  ref: string | null;
  line: string;
}

const NONE: Found = { exposed: false, named: false, ref: null, line: "" };

/**
 * Playwright MCP browser_snapshot (YAML).
 *   이름이 있으면:     - button "TARGET" [ref=e3] [cursor=pointer]
 *   텍스트만 남으면:   - button [ref=e3] [cursor=pointer]: TARGET
 * 후자가 IntentGuard에서 본 `button [ref=e48]: 경기 시작`과 같은 형태다.
 */
export function parsePlaywrightSnapshot(text: string, target = "TARGET"): Found {
  const lines = text.split(/\r?\n/).filter((l) => l.includes(target));
  if (lines.length === 0) return NONE;
  const button = lines.find((l) => /^\s*-\s*button\b/.test(l)) ?? lines[0];
  const ref = button.match(/\[ref=([^\]]+)\]/)?.[1] ?? null;
  const named = /^\s*-\s*button\s+"/.test(button) && button.includes(`button "${target}"`);
  return { exposed: true, named, ref, line: button.trim() };
}

/**
 * Chrome DevTools MCP take_snapshot.
 *   uid=1_3 button "TARGET"
 * 텍스트만 남으면 StaticText 줄에만 나타난다.
 */
export function parseDevtoolsSnapshot(text: string, target = "TARGET"): Found {
  const lines = text.split(/\r?\n/).filter((l) => l.includes(`"${target}"`) || l.includes(target));
  if (lines.length === 0) return NONE;
  const button = lines.find((l) => /\bbutton\b/.test(l)) ?? lines[0];
  const ref = button.match(/uid=(\S+)/)?.[1] ?? null;
  const named = button.includes(`button "${target}"`);
  return { exposed: true, named, ref, line: button.trim() };
}

/** MCP 도구가 돌려준 오류 문장을 클릭 결과로 분류한다. */
export function classifyClickError(message: string): "intercepted" | "timeout" | "stale-ref" | "error" {
  if (/intercepts pointer events/i.test(message)) return "intercepted";
  if (/not found|stale|No (element|node)/i.test(message)) return "stale-ref";
  if (/timeout|timed out|exceeded/i.test(message)) return "timeout";
  return "error";
}
