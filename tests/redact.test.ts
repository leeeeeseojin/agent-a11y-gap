import { describe, expect, it } from "vitest";
import { redactPaths } from "../bench/redact.js";

const repo = "C:\\Work\\agent-a11y-gap";
const home = "C:\\Users\\someone";

describe("경로 지우기", () => {
  it("JSON으로 이스케이프된 홈 경로와 레포 경로를 바꾼다", () => {
    const json = JSON.stringify({ text: `${home}\\.gemini\\mcp and ${repo}\\.tmp\\pw-mcp` });
    expect(redactPaths(json, repo, home)).toBe(JSON.stringify({ text: "~\\.gemini\\mcp and <repo>\\.tmp\\pw-mcp" }));
  });

  it("도구 응답 안에 한 번 더 이스케이프되어 들어온 경로도 바꾼다", () => {
    const nested = JSON.stringify({ text: JSON.stringify({ path: `${home}\\x` }) });
    expect(redactPaths(nested, repo, home)).not.toContain("someone");
  });
});
