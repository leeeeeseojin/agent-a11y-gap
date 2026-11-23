// 모달의 사람 기준 세 가지. E2E(e2e/modal.spec.ts)와 3층 표(probe/layer3.ts)가 같은 함수를 쓴다.
import type { Page } from "playwright";

export const IMPLS = ["A", "B", "C", "D", "E"] as const;
export type Impl = (typeof IMPLS)[number];

export interface HumanChecks {
  /** 시트가 열린 동안 Chrome 접근성 트리(스크린 리더 기준)에서 배경 "경기 시작"이 빠졌는가 */
  backgroundHidden: boolean;
  /** Tab을 여러 번 눌러도 포커스가 시트 안에 머무는가 */
  focusTrapped: boolean;
  /** Esc로 닫히고, 시트를 연 버튼으로 포커스가 돌아오는가 */
  escRestoresFocus: boolean;
}

export async function openSettings(page: Page, baseURL: string, impl: Impl) {
  await page.goto(`${baseURL}/modal/?impl=${impl}&run=e2e-${impl}`);
  await page.getByRole("button", { name: "운영 방식 설정" }).click();
  await page.getByRole("heading", { name: "경기 운영 설정" }).waitFor();
}

/**
 * getByRole이 아니라 CDP 트리로 본다. Playwright 1.65부터 getByRole은 inert 요소와 모달 dialog 밖 콘텐츠를
 * 걸러내지 않는다(#43792에서 정한 동작). 그래서 getByRole을 사람 기준으로 쓰면 B와 C를 실패로 잘못 판정한다.
 */
export async function backgroundHidden(page: Page): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[] };
  await cdp.detach();
  return !nodes.some((n) => !n.ignored && n.role?.value === "button" && n.name?.value === "경기 시작");
}

export async function focusTrapped(page: Page, presses = 8): Promise<boolean> {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    // 마지막 버튼 다음에 포커스가 브라우저 UI로 나가는 것(activeElement가 body)은 허용한다.
    // 네이티브 dialog도 그렇게 동작하고, 문제는 포커스가 "배경의 버튼"에 닿는 경우다.
    const inside = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) return true;
      const sheet = document.querySelector("[role=dialog], dialog[open], main.page");
      return !!sheet && sheet.contains(a);
    });
    if (!inside) return false;
  }
  return true;
}

export async function escRestoresFocus(page: Page): Promise<boolean> {
  await page.keyboard.press("Escape");
  const closed = (await page.getByRole("heading", { name: "경기 운영 설정" }).count()) === 0;
  const focused = await page.evaluate(() => document.activeElement?.id === "open-settings");
  return closed && focused;
}

export async function measureHuman(page: Page, baseURL: string, impl: Impl): Promise<HumanChecks> {
  await openSettings(page, baseURL, impl);
  const hidden = await backgroundHidden(page);
  const trapped = await focusTrapped(page);
  // 포커스 검사로 시트 안 버튼이 눌리지 않았으니 시트는 그대로 열려 있다
  const esc = await escRestoresFocus(page);
  return { backgroundHidden: hidden, focusTrapped: trapped, escRestoresFocus: esc };
}
