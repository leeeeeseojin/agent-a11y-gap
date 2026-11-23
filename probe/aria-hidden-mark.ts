// [aria-hidden] 표시가 어떤 DOM 구조에서 남고 사라지는지 AI 스냅샷으로 바로 보여 준다.
// docs/aria-hidden-mark.md의 표는 이 스크립트의 출력이다.
//
//   npx tsx probe/aria-hidden-mark.ts
import { launchChrome } from "./lib/env.js";

const app = `<h1>홈</h1><button>경기 시작</button><button>로스터 편집</button>`;
const sheet = `<div role="dialog" aria-modal="true" aria-label="경기 운영 설정"><button>닫기</button></div>`;

// 앞의 셋은 속성 위치와 자식 수만 바꾼 비교군이고, 뒤의 셋은 MY DUGOUT 구조와 화면 쪽 우회 방법이다
const structures: Record<string, string> = {
  "버튼 자체": `<button aria-hidden="true">경기 시작</button>`,
  "조상 div, 자식 1개": `<div aria-hidden="true"><button>경기 시작</button></div>`,
  "조상 div, 자식 2개": `<div aria-hidden="true"><button>경기 시작</button><button>로스터 편집</button></div>`,
  "#root > 래퍼 div (MY DUGOUT 구조)": `<div id="root" aria-hidden="true" inert><div class="app">${app}</div></div>${sheet}`,
  "우회 1: 자식이 여럿인 래퍼에 건다": `<div id="root"><div class="app" aria-hidden="true" inert>${app}</div></div>${sheet}`,
  "우회 2: #root에 이름을 붙여 건다": `<div id="root" role="region" aria-label="배경 화면" aria-hidden="true" inert><div class="app">${app}</div></div>${sheet}`,
};

const browser = await launchChrome();
const page = await browser.newPage();
try {
  for (const [label, html] of Object.entries(structures)) {
    // 비교 대상이 body의 유일한 자식이 되지 않도록 앞에 버튼 하나를 둔다. 유일한 자식이면 맨 윗줄로 합쳐져 구조가 달라진다
    await page.setContent(`<button>CONTROL</button>${html}`);
    const snapshot = await page.locator("body").ariaSnapshot({ mode: "ai" });
    // 맨 윗줄은 body를 감싼 generic이라 뺀다
    console.log(`## ${label}\n${snapshot.split("\n").slice(1).join("\n")}\n`);
  }
} finally {
  await browser.close();
}
