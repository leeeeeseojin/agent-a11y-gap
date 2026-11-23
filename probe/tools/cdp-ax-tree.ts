// 기준선은 Chrome이 스크린 리더에 넘기는 전체 접근성 트리(CDP Accessibility.getFullAXTree)다.
// 이 프로젝트에서 "사람 기준"은 이 트리에서 ignored가 아닌가로 정한다.
import type { Browser } from "playwright";
import { NOT_FOUND, reading, type Found } from "../parse.js";
import type { ProbeTarget, Reading } from "../types.js";

interface AXNode {
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
}

export async function readCdpTree(browser: Browser, target: ProbeTarget): Promise<Reading> {
  const page = await browser.newPage();
  try {
    await page.goto(target.url);
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };

    const visible = nodes.filter((n) => !n.ignored && n.name?.value?.includes(target.name));
    const button = visible.find((n) => n.role?.value === "button" && n.name?.value === target.name);
    const node = button ?? visible[0];
    const found: Found = node ? { exposed: true, named: !!button, ref: null, marked: false, line: `${node.role?.value} "${node.name?.value}"` } : NOT_FOUND;

    // CDP 트리는 누를 수 있는 ref를 주지 않으므로 클릭은 재지 않는다
    return reading("cdp-ax-tree", found, "not-attempted");
  } finally {
    await page.close();
  }
}
