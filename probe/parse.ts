// 도구마다 다른 출력에서 대상 버튼의 흔적을 찾고, 결과를 같은 모양(Reading)으로 맞춘다.
// 같은 판정 규칙을 두 MCP에 똑같이 적용해야 도구 간 비교가 공정하다.
import type { ClickOutcome, Reading, Tool } from "./types.js";

export interface Found {
  exposed: boolean;
  named: boolean;
  ref: string | null;
  /** 그 줄이나 조상 줄에 [aria-hidden] 표시가 있는가 */
  marked: boolean;
  line: string;
}

export const NOT_FOUND: Found = { exposed: false, named: false, ref: null, marked: false, line: "" };

/**
 * Playwright MCP browser_snapshot (YAML).
 *   이름이 있으면:     - button "TARGET" [ref=e3] [cursor=pointer]
 *   텍스트만 남으면:   - button [ref=e3] [cursor=pointer]: TARGET
 * 후자가 IntentGuard에서 본 `button [ref=e48]: 경기 시작`과 같은 형태다.
 *
 * aria-hidden 요소에는 `[aria-hidden]` 표시가 붙는다(PR #42268). 표시는 속성이 붙은 요소의 줄에만 있으므로,
 * 대상 줄부터 들여쓰기가 더 얕은 조상 줄까지 거슬러 올라가며 확인한다.
 */
export function parsePlaywrightSnapshot(text: string, target = "TARGET"): Found {
  const all = text.split(/\r?\n/);
  const candidates = all.map((l, i) => ({ l, i })).filter(({ l }) => l.includes(target));
  if (candidates.length === 0) return NOT_FOUND;
  const { l: button, i } = candidates.find(({ l }) => /^\s*-\s*button\b/.test(l)) ?? candidates[0];
  const ref = button.match(/\[ref=([^\]]+)\]/)?.[1] ?? null;
  const named = button.includes(`button "${target}"`);
  return { exposed: true, named, ref, marked: selfOrAncestorMarked(all, i), line: button.trim() };
}

function selfOrAncestorMarked(lines: string[], index: number): boolean {
  const indent = (l: string) => l.length - l.trimStart().length;
  let depth = indent(lines[index]);
  if (lines[index].includes("[aria-hidden]")) return true;
  for (let i = index - 1; i >= 0; i--) {
    if (!lines[i].trimStart().startsWith("-") || indent(lines[i]) >= depth) continue;
    if (lines[i].includes("[aria-hidden]")) return true;
    depth = indent(lines[i]);
  }
  return false;
}

/**
 * Chrome DevTools MCP take_snapshot.
 *   uid=1_3 button "TARGET"
 * 이름 없이 텍스트만 남으면 StaticText 줄에만 나타난다.
 */
export function parseDevtoolsSnapshot(text: string, target = "TARGET"): Found {
  const lines = text.split(/\r?\n/).filter((l) => l.includes(target));
  if (lines.length === 0) return NOT_FOUND;
  const button = lines.find((l) => /\bbutton\b/.test(l)) ?? lines[0];
  const ref = button.match(/uid=(\S+)/)?.[1] ?? null;
  const named = button.includes(`button "${target}"`);
  // DevTools MCP 스냅샷에는 aria-hidden 요소가 나오지 않으므로 표시도 없다
  return { exposed: true, named, ref, marked: false, line: button.trim() };
}

/** 도구가 돌려준 오류 문장을 클릭 결과로 분류한다. */
export function classifyClickError(message: string): "intercepted" | "timeout" | "stale-ref" | "error" {
  if (/intercepts pointer events/i.test(message)) return "intercepted";
  if (/not found|stale|No (element|node)/i.test(message)) return "stale-ref";
  if (/timeout|timed out|exceeded/i.test(message)) return "timeout";
  return "error";
}

/**
 * 오류 응답에서 원인이 드러나는 한 줄. "### Error" 같은 머리글과 터미널 색 코드는 뺀다.
 * 시간 초과는 그 자체보다 Playwright가 무엇을 기다렸는지가 중요하다. 1.65부터 inert 요소는 로케이터에서
 * 걸러지지 않고 클릭할 때 "element is inert"로 기다리게 되었으므로(Playwright #43792) 그 줄을 먼저 고른다.
 */
export function errorLine(text: string): string {
  const lines = meaningfulLines(text);
  const pick =
    lines.find((l) => /intercepts pointer events/i.test(l)) ??
    lines.find((l) => /element is inert/i.test(l)) ??
    lines.find((l) => /error|timeout|not found|did not/i.test(l)) ??
    lines[0] ??
    "";
  return pick.slice(0, 200);
}

export function firstLine(text: string): string {
  return (meaningfulLines(text)[0] ?? "").slice(0, 200);
}

function meaningfulLines(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("```"));
}

export function reading(tool: Tool, found: Found, click: ClickOutcome, detail = ""): Reading {
  return {
    tool,
    exposed: found.exposed,
    named: found.named,
    marked: found.marked,
    ref: found.ref,
    click,
    evidence: [found.line, detail].filter(Boolean).join(" | ").slice(0, 300),
  };
}
