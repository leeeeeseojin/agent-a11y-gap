// data-probe가 붙은 버튼을 누르면 서버에 기록한다.
// 수집기는 에이전트 도구의 "클릭 성공" 응답을 믿지 않고 이 기록으로 실제 클릭 여부를 판정한다.
// IntentGuard에서 에이전트 보고 대신 서버 상태로 채점한 것과 같은 이유다.
const caseId = document.documentElement.dataset.case;
for (const el of document.querySelectorAll("[data-probe]")) {
  el.addEventListener("click", () => {
    navigator.sendBeacon(`/hit?case=${encodeURIComponent(caseId)}&el=${encodeURIComponent(el.dataset.probe)}`);
  });
}
