// 경기 준비 화면 + 운영 설정 시트. 구현(A~D)만 다르고 화면 문구와 동작은 같다.
// 상태는 바뀔 때마다 서버(/state/<run>)에 올린다. 2층 채점은 에이전트의 보고가 아니라 이 값으로 한다.

const params = new URLSearchParams(location.search);
const IMPL = ["A", "B", "C", "D"].includes(params.get("impl")) ? params.get("impl") : "B";
const RUN = params.get("run") ?? "manual";
const app = document.getElementById("app");

const LABEL = { coach: "코치에게", me: "내가" };
const state = {
  impl: IMPL,
  settings: { attack: "me", pitching: "me" },
  saved: 0, // 시트의 "저장"을 누른 횟수
  rosterSaved: 0, // 배경의 "저장"(로스터)을 누른 횟수. 설정 과제에서 이게 늘면 엉뚱한 버튼을 누른 것
  started: false,
  startedWith: null, // 경기를 시작한 순간의 설정
};

function sync() {
  fetch(`/state/${encodeURIComponent(RUN)}`, { method: "POST", body: JSON.stringify(state) }).catch(() => {});
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------------------
// 홈 (배경)
// ---------------------------------------------------------------------------

function renderHome() {
  const s = state.settings;
  const home = el(
    "main",
    { class: "home", id: "home" },
    el("h1", {}, "경기 준비"),
    el("p", { class: "status", id: "status" }, state.started ? "경기가 시작됐습니다." : `공격 작전: ${LABEL[s.attack]} · 투수 교체: ${LABEL[s.pitching]}`),
    el("button", { type: "button", id: "open-settings", onclick: (e) => openSheet(e.currentTarget) }, "운영 방식 설정"),
    el("button", { type: "button", class: "primary", onclick: start }, "경기 시작"),
    el("p", { class: "status" }, "로스터 변경 사항"),
    // 시트 안의 "저장"과 같은 이름. 의도적인 함정이다
    el("button", { type: "button", onclick: saveRoster }, "저장"),
  );
  app.replaceChildren(home);
}

function start() {
  state.started = true;
  state.startedWith = { ...state.settings };
  sync();
  renderHome();
}

function saveRoster() {
  state.rosterSaved++;
  sync();
  document.getElementById("status").textContent = "로스터를 저장했습니다.";
}

// ---------------------------------------------------------------------------
// 시트 내용 (네 구현이 같이 쓴다)
// ---------------------------------------------------------------------------

function sheetBody(draft, onSave, onClose) {
  const choice = (key, legend) => {
    const buttons = ["coach", "me"].map((v) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(draft[key] === v),
          onclick: () => {
            draft[key] = v;
            for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.v === draft[key]));
          },
          "data-v": v,
        },
        LABEL[v],
      ),
    );
    return el("fieldset", {}, el("legend", {}, legend), el("div", { class: "row" }, ...buttons));
  };
  return [
    el("h2", { id: "sheet-title" }, "경기 운영 설정"),
    choice("attack", "공격 작전"),
    choice("pitching", "투수 교체"),
    el(
      "div",
      { class: "actions" },
      el("button", { type: "button", onclick: onClose }, "닫기"),
      el("button", { type: "button", class: "primary", onclick: onSave }, "저장"),
    ),
  ];
}

// ---------------------------------------------------------------------------
// 구현별 열기·닫기
// ---------------------------------------------------------------------------

function openSheet(opener) {
  const draft = { ...state.settings };
  const save = () => {
    state.settings = { ...draft };
    state.saved++;
    sync();
    close();
  };
  let close;

  if (IMPL === "D") {
    // D: 배경을 DOM에서 내리고 설정을 별도 화면으로 그린다. 배경 버튼은 어떤 트리에도 남지 않는다.
    // 비용: 사람은 뒤 화면의 맥락(현재 상태 문구)을 보면서 고를 수 없다.
    const page = el("main", { class: "page", "aria-labelledby": "sheet-title" }, ...sheetBody(draft, () => save(), () => close()));
    const onKey = (e) => e.key === "Escape" && (e.preventDefault(), close());
    close = () => {
      document.removeEventListener("keydown", onKey);
      renderHome();
      document.getElementById("open-settings")?.focus();
    };
    document.addEventListener("keydown", onKey);
    app.replaceChildren(page);
    page.querySelector("button")?.focus();
    return;
  }

  if (IMPL === "C") {
    // C: 브라우저 표준 모달. showModal()이 바깥을 inert로 만들고 Esc·포커스 복귀도 처리한다.
    const dialog = el("dialog", { class: "sheet", "aria-labelledby": "sheet-title" }, ...sheetBody(draft, () => save(), () => close()));
    close = () => dialog.close();
    dialog.addEventListener("close", () => {
      dialog.remove();
      opener?.focus();
      renderStatus();
    });
    document.body.append(dialog);
    dialog.showModal();
    return;
  }

  // A·B: div 시트. 반투명 판이 화면을 덮어 배경 클릭을 막는다.
  const root = document.getElementById("app");
  const dialog = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "sheet-title", tabindex: "-1" }, ...sheetBody(draft, () => save(), () => close()));
  const backdrop = el("div", { class: "sheet-backdrop", onclick: (e) => e.target === backdrop && close() }, dialog);
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (IMPL === "B") {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
    }
    opener?.focus();
    renderStatus();
  };
  if (IMPL === "B") {
    // B: MY DUGOUT Sheet.tsx와 같은 처리. 사람·스크린 리더 기준으로는 배경이 사라진다
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
  }
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  dialog.focus();
}

function renderStatus() {
  const s = state.settings;
  const status = document.getElementById("status");
  if (status && !state.started) status.textContent = `공격 작전: ${LABEL[s.attack]} · 투수 교체: ${LABEL[s.pitching]}`;
}

renderHome();
sync();
// ?open=1이면 시트가 열린 상태로 시작한다. 2층의 일부 과제가 이 상태에서 출발한다.
if (params.get("open") === "1") openSheet(document.getElementById("open-settings"));
