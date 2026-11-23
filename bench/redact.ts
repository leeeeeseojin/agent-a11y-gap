// 결과 JSON에 남는 로컬 경로를 지운다. 도구 응답에는 MCP 출력 폴더나 agy 설정 폴더 같은 절대 경로가 섞여 오는데,
// 홈 폴더 경로에는 계정 이름이 들어 있어서 공개 레포에 올리기 전에 바꿔 둔다.
import os from "node:os";

/** 경로 하나를 JSON 안에서 나타날 수 있는 모양(그대로, 한 번 이스케이프, 두 번 이스케이프)으로 모두 만든다 */
function variants(dir: string): string[] {
  const forward = dir.replace(/\\/g, "/");
  return [dir.replace(/\\/g, "\\\\\\\\"), dir.replace(/\\/g, "\\\\"), dir, forward];
}

/** 직렬화한 JSON 문자열에서 레포 경로는 "<repo>", 홈 폴더 경로는 "~"로 바꾼다. 레포가 홈 아래에 있을 수 있어 레포를 먼저 바꾼다 */
export function redactPaths(json: string, repo = process.cwd(), home = os.homedir()): string {
  let out = json;
  for (const [dir, label] of [[repo, "<repo>"], [home, "~"]] as const) {
    for (const v of variants(dir)) out = out.split(v).join(label);
  }
  return out;
}
