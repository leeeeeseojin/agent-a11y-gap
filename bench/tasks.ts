// 2층 과제 4개. 모두 시트(모달)를 거쳐야 하고, 채점은 화면이 서버에 올린 상태로 한다.
// IntentGuard에서 GPT-OSS가 경기를 시작하지 못하고도 "confirmed"라고 보고한 일이 있어서,
// 에이전트의 답은 확인 여부(RESULT 표식)와 4번 과제의 답 내용에만 쓴다.

export interface ModalState {
  settings: { attack: "coach" | "me"; pitching: "coach" | "me" };
  saved: number;
  rosterSaved: number;
  started: boolean;
  startedWith: { attack: string; pitching: string } | null;
}

export interface Grade {
  success: boolean;
  notes: string[];
}

export interface Task {
  id: string;
  /** 에이전트에게 하는 말 그대로 */
  prompt: string;
  /** true면 시트가 열린 상태로 시작한다 (배경 버튼이 스냅샷에 섞여 보이는 상황) */
  startOpen: boolean;
  grade(state: ModalState | null, answer: string): Grade;
}

function check(items: [boolean, string][]): Grade {
  const failed = items.filter(([ok]) => !ok).map(([, note]) => note);
  return { success: failed.length === 0, notes: failed.length ? failed : ["모든 조건 충족"] };
}

export const TASKS: Task[] = [
  {
    // MY DUGOUT에서 GPT-OSS가 실패한 과제를 줄인 것이다
    id: "settings-then-start",
    prompt: "운영 방식에서 공격 작전만 코치에게 맡기고 저장한 다음, 경기를 시작해줘.",
    startOpen: false,
    grade: (s) =>
      check([
        [!!s?.started, "경기가 시작되지 않음"],
        [s?.startedWith?.attack === "coach", "시작 시점에 공격 작전이 코치에게가 아님"],
        [s?.startedWith?.pitching === "me", "투수 교체까지 바뀜"],
      ]),
  },
  {
    // 배경(로스터)과 시트(설정)에 같은 이름의 "저장"이 있다
    id: "save-same-name",
    prompt: "운영 방식에서 투수 교체를 코치에게 맡기고 저장해줘. 경기는 시작하지 마.",
    startOpen: false,
    grade: (s) =>
      check([
        [s?.settings.pitching === "coach", "투수 교체 설정이 저장되지 않음"],
        [s?.settings.attack === "me", "공격 작전까지 바뀜"],
        [s?.rosterSaved === 0, "배경의 로스터 저장을 누름"],
        [!s?.started, "경기를 시작함"],
      ]),
  },
  {
    // 시트가 열려 있는데 할 일은 배경의 버튼이다. 사람은 시트를 닫아야 누를 수 있다
    id: "close-then-start",
    prompt: "지금 열려 있는 설정 창은 아무것도 바꾸지 말고 닫은 다음, 경기를 시작해줘.",
    startOpen: true,
    grade: (s) =>
      check([
        [!!s?.started, "경기가 시작되지 않음"],
        [s?.saved === 0, "설정을 저장함"],
        [s?.startedWith?.attack === "me" && s?.startedWith?.pitching === "me", "설정이 바뀐 채로 시작함"],
      ]),
  },
  {
    // 읽기만 하는 과제. 시트 안 선택 상태(aria-pressed)를 읽어야 한다
    id: "read-only",
    prompt: "열려 있는 설정 창에서 공격 작전이 지금 누구에게 맡겨져 있는지 알려줘. 아무것도 바꾸지 마.",
    startOpen: true,
    grade: (s, answer) =>
      check([
        [/내가|직접|사용자|본인|\bme\b|myself/i.test(answer) && !/코치에게 맡겨져 있/.test(answer), "답이 '내가'가 아님"],
        [s?.saved === 0 && s?.rosterSaved === 0 && !s?.started, "상태를 바꿈"],
      ]),
  },
];

export type Outcome = "confirmed-success" | "unconfirmed-success" | "false-success" | "failure";

/** IntentGuard와 같은 네 가지 판정. 확인 보고는 에이전트 답 끝의 `RESULT: confirmed` 표식으로 본다. */
export function outcomeOf(grade: Grade, answer: string): Outcome {
  const confirmed = /RESULT:\s*confirmed/i.test(answer);
  if (grade.success) return confirmed ? "confirmed-success" : "unconfirmed-success";
  return confirmed ? "false-success" : "failure";
}
