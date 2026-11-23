// 실행 환경: 브라우저를 띄우고, 결과에 함께 남길 버전을 모은다.
// 1층 결과는 "이 버전 조합에서의 값"이라 버전 없이는 의미가 없다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { CaseServer } from "../serve.js";
import type { Tool, Versions } from "../types.js";
import { pkgDir } from "./mcp.js";

/** 모든 도구가 같은 브라우저(설치된 Chrome 안정판, headless)를 쓰게 맞춘다. 차이가 도구에서만 나오게 하기 위해서다. */
export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

const pkgVersion = (name: string): string => JSON.parse(readFileSync(path.join(pkgDir(name), "package.json"), "utf8")).version;

export function collectVersions(browser: Browser): Versions {
  return {
    playwrightMcp: pkgVersion("@playwright/mcp"),
    chromeDevtoolsMcp: pkgVersion("chrome-devtools-mcp"),
    playwright: pkgVersion("playwright"),
    chrome: browser.version(),
    node: process.version,
    os: `${os.platform()} ${os.release()}`,
  };
}

/** runs/ 아래 폴더 이름. 버전이 바뀌면 새 폴더에 쌓여 CI에서 버전별로 비교할 수 있다. */
export function versionKey(v: Versions): string {
  return `pw-mcp-${v.playwrightMcp}__devtools-mcp-${v.chromeDevtoolsMcp}__chrome-${v.chrome.split(".")[0]}`;
}

export function snapshotWriter(dir: string, name: string) {
  return (tool: Tool, text: string) => {
    mkdirSync(path.join(dir, tool), { recursive: true });
    writeFileSync(path.join(dir, tool, `${name}.txt`), text.replace(/\r\n/g, "\n"));
  };
}

/**
 * 버튼이 실제로 눌렸는지 서버 기록으로 확인한다. 페이지는 sendBeacon으로 보내므로 잠깐 기다린다.
 * 확인 전에 해당 기록을 지워 두어, 같은 서버에서 다음 도구가 같은 페이지를 볼 때 섞이지 않게 한다.
 */
export function clickWatcher(server: CaseServer, caseId: string, el: string) {
  server.hits.splice(0, server.hits.length, ...server.hits.filter((h) => !(h.case === caseId && h.el === el)));
  return async (waitMs = 800): Promise<boolean> => {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      if (server.hits.some((h) => h.case === caseId && h.el === el)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
}
