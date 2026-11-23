// 설계 대안 A~E가 사람 기준을 지키는지 확인한다.
// A는 MY DUGOUT 수정 전처럼 aria-modal만 있어서 배경 숨김과 포커스 가둠을 지키지 못하는 것이 기대값이다.
// 기대값은 처음 측정한 결과로 정했고, 브라우저가 바뀌어 결과가 달라지면 이 테스트가 먼저 알려 준다.
import { expect, test } from "@playwright/test";
import { IMPLS, backgroundHidden, escRestoresFocus, focusTrapped, openSettings, type HumanChecks, type Impl } from "../probe/human.js";

const EXPECTED: Record<Impl, HumanChecks> = {
  A: { backgroundHidden: false, focusTrapped: false, escRestoresFocus: true },
  B: { backgroundHidden: true, focusTrapped: true, escRestoresFocus: true },
  C: { backgroundHidden: true, focusTrapped: true, escRestoresFocus: true },
  D: { backgroundHidden: true, focusTrapped: true, escRestoresFocus: true },
  // E는 B에 열린 동안만 role=region과 이름을 붙인 것이라 사람 기준은 B와 같아야 한다
  E: { backgroundHidden: true, focusTrapped: true, escRestoresFocus: true },
};

for (const impl of IMPLS) {
  test.describe(`구현 ${impl}`, () => {
    test.beforeEach(async ({ page, baseURL }) => openSettings(page, baseURL!, impl));

    test("시트가 열린 동안 배경 버튼이 접근성 트리에서 빠지는가", async ({ page }) => {
      expect(await backgroundHidden(page)).toBe(EXPECTED[impl].backgroundHidden);
    });

    test("Tab으로 배경 버튼에 포커스가 닿지 않는가", async ({ page }) => {
      expect(await focusTrapped(page)).toBe(EXPECTED[impl].focusTrapped);
    });

    test("Esc로 닫히고 연 버튼으로 포커스가 돌아오는가", async ({ page }) => {
      expect(await escRestoresFocus(page)).toBe(EXPECTED[impl].escRestoresFocus);
    });
  });
}

test("시트에서 저장한 설정으로 경기가 시작된다 (채점용 상태 기록 확인)", async ({ page, baseURL, request }) => {
  await openSettings(page, baseURL!, "C");
  await page.getByRole("group", { name: "공격 작전" }).getByRole("button", { name: "코치에게" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "저장" }).click();
  await page.getByRole("button", { name: "경기 시작" }).click();

  const state = await (await request.get(`${baseURL}/state/e2e-C`)).json();
  expect(state).toMatchObject({ started: true, startedWith: { attack: "coach", pitching: "me" }, saved: 1, rosterSaved: 0 });
});
