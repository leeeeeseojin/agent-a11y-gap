import { describe, expect, it } from "vitest";
import { classifyClickError, errorLine, parseDevtoolsSnapshot, parsePlaywrightSnapshot } from "../probe/parse.js";

describe("parsePlaywrightSnapshot", () => {
  it("이름이 붙은 버튼", () => {
    const f = parsePlaywrightSnapshot('- generic [ref=e1]:\n  - button "TARGET" [ref=e3] [cursor=pointer]');
    expect(f).toMatchObject({ exposed: true, named: true, ref: "e3" });
  });

  it("이름 없이 텍스트만 남은 버튼 (MY DUGOUT 수정 후 스냅샷과 같은 형태)", () => {
    const f = parsePlaywrightSnapshot("    - button [ref=e54] [cursor=pointer]: TARGET");
    expect(f).toMatchObject({ exposed: true, named: false, ref: "e54" });
  });

  it("[aria-hidden] 표시: 버튼 줄에 있으면 찾는다", () => {
    const f = parsePlaywrightSnapshot('- generic [ref=e1]:\n  - button "CONTROL" [ref=e2]\n  - button [aria-hidden] [ref=e3]: TARGET');
    expect(f).toMatchObject({ exposed: true, named: false, marked: true });
  });

  it("[aria-hidden] 표시: 조상 줄에 있어도 찾는다 (이름 있는 영역)", () => {
    const f = parsePlaywrightSnapshot('- generic [ref=e1]:\n  - region [aria-hidden] [ref=e2]:\n    - button [ref=e3]: TARGET');
    expect(f.marked).toBe(true);
  });

  it("[aria-hidden] 표시: 형제 줄의 표시는 대상과 상관없다", () => {
    const f = parsePlaywrightSnapshot('- generic [ref=e1]:\n  - button [aria-hidden] [ref=e2]: OTHER\n  - button [ref=e3]: TARGET');
    expect(f.marked).toBe(false);
  });

  it("[aria-hidden] 표시: 조상 div가 접힌 스냅샷에는 단서가 없다", () => {
    const f = parsePlaywrightSnapshot('- generic [ref=e1]:\n  - button "CONTROL" [ref=e2]\n  - button [ref=e3]: TARGET');
    expect(f).toMatchObject({ exposed: true, named: false, marked: false });
  });

  it("없으면 노출되지 않음", () => {
    expect(parsePlaywrightSnapshot('- button "CONTROL" [ref=e2]').exposed).toBe(false);
  });
});

describe("parseDevtoolsSnapshot", () => {
  it("button 줄을 StaticText 줄보다 우선한다", () => {
    const f = parseDevtoolsSnapshot('uid=1_0 RootWebArea "x"\n  uid=1_3 button "TARGET"\n    uid=1_4 StaticText "TARGET"');
    expect(f).toMatchObject({ exposed: true, named: true, ref: "1_3" });
  });

  it("텍스트만 남으면 이름 없음", () => {
    const f = parseDevtoolsSnapshot('  uid=1_3 button\n    uid=1_4 StaticText "TARGET"');
    expect(f).toMatchObject({ exposed: true, named: false, ref: "1_4" });
  });
});

describe("errorLine", () => {
  it("시간 초과보다 무엇을 기다렸는지를 먼저 남긴다", () => {
    const log = "TimeoutError: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for locator('x')\n    - element is inert";
    expect(errorLine(log)).toBe("- element is inert");
  });
});

describe("classifyClickError", () => {
  it("IntentGuard GPT-OSS 실행에서 본 오류 문장", () => {
    expect(classifyClickError("<div class=\"sheet-backdrop\">…</div> intercepts pointer events")).toBe("intercepted");
    expect(classifyClickError("TimeoutError: locator.click: Timeout 5000ms exceeded.")).toBe("timeout");
    expect(classifyClickError("Error: Ref e55 not found in the current page snapshot.")).toBe("stale-ref");
  });
});
