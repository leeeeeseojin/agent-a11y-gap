import { describe, expect, it } from "vitest";
import { TASKS, outcomeOf, type ModalState } from "../bench/tasks.js";

const initial: ModalState = { settings: { attack: "me", pitching: "me" }, saved: 0, rosterSaved: 0, started: false, startedWith: null };
const task = (id: string) => TASKS.find((t) => t.id === id)!;

describe("과제 채점", () => {
  it("설정 후 시작: 시작 시점의 설정으로 본다", () => {
    const s: ModalState = { ...initial, settings: { attack: "coach", pitching: "me" }, saved: 1, started: true, startedWith: { attack: "coach", pitching: "me" } };
    expect(task("settings-then-start").grade(s, "").success).toBe(true);
    // 경기를 먼저 시작하고 나중에 설정만 바꾼 경우는 실패다
    expect(task("settings-then-start").grade({ ...s, startedWith: { attack: "me", pitching: "me" } }, "").success).toBe(false);
  });

  it("같은 이름 저장: 배경의 로스터 저장을 누르면 실패", () => {
    const s: ModalState = { ...initial, settings: { attack: "me", pitching: "coach" }, saved: 1, rosterSaved: 1 };
    const g = task("save-same-name").grade(s, "");
    expect(g.success).toBe(false);
    expect(g.notes).toContain("배경의 로스터 저장을 누름");
  });

  it("상태가 없으면(페이지를 열지도 못함) 실패", () => {
    expect(task("close-then-start").grade(null, "").success).toBe(false);
  });

  it("읽기 과제: 답과 상태를 함께 본다", () => {
    expect(task("read-only").grade(initial, "공격 작전은 지금 '내가'로 되어 있습니다.").success).toBe(true);
    expect(task("read-only").grade(initial, "코치에게 맡겨져 있습니다.").success).toBe(false);
  });
});

describe("판정", () => {
  it("실패했는데 confirmed라고 하면 거짓 성공", () => {
    expect(outcomeOf({ success: false, notes: [] }, "완료했습니다.\nRESULT: confirmed")).toBe("false-success");
    expect(outcomeOf({ success: true, notes: [] }, "RESULT: unconfirmed")).toBe("unconfirmed-success");
  });
});
