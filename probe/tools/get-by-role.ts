// Playwright getByRole은 사람 기준 E2E를 쓸 때 보통 고르는 로케이터다.
// 1.65부터 inert 요소와 모달 dialog 밖 콘텐츠를 걸러내지 않고, 클릭할 때 "element is inert"로 기다린다
// (Playwright #43792). 1층의 inert 조상·네이티브 dialog 결과가 이 동작과 같다.
import type { Browser } from "playwright";
import { NOT_FOUND, classifyClickError, errorLine, reading, type Found } from "../parse.js";
import type { ProbeTarget, Reading } from "../types.js";

export async function readGetByRole(browser: Browser, target: ProbeTarget): Promise<Reading> {
  const page = await browser.newPage();
  try {
    await page.goto(target.url);
    const locator = page.getByRole("button", { name: target.name, exact: true });
    const count = await locator.count();
    if (count === 0) return reading("pw-get-by-role", NOT_FOUND, "not-attempted");

    const found: Found = { exposed: true, named: true, ref: "getByRole", line: `getByRole('button', { name: '${target.name}' }) → ${count}개` };
    try {
      await locator.first().click({ timeout: 3000 });
    } catch (e) {
      if (await target.wasClicked()) return reading("pw-get-by-role", found, "clicked");
      return reading("pw-get-by-role", found, classifyClickError(String(e)), errorLine(String(e)));
    }
    return reading("pw-get-by-role", found, (await target.wasClicked()) ? "clicked" : "no-effect");
  } finally {
    await page.close();
  }
}
