// 1층에서 비교하는 숨김 패턴 목록이다. 페이지는 cases/patterns/<id>.html에 있다.
// preliminary가 true인 9종은 예비 재현에서 이미 돌려 본 것이고, 나머지 7종은 이번에 더했다.
// aria-hidden은 속성의 위치만 다른 세 가지(조상 div, 버튼 자체, 이름 있는 영역)를 붙여 두었다.
// 스냅샷의 [aria-hidden] 표시가 어떤 구조에서 사라지는지 비교하기 위해서다.
export interface Pattern {
  id: string;
  label: string;
  /** 무엇으로 숨기는가: 속성(attribute)·CSS 렌더·시각적으로만 가림 */
  mechanism: "attribute" | "render" | "visual";
  preliminary: boolean;
}

export const PATTERNS: Pattern[] = [
  { id: "aria-hidden-ancestor", label: "aria-hidden 조상", mechanism: "attribute", preliminary: true },
  { id: "aria-hidden-self", label: "aria-hidden 버튼 자체", mechanism: "attribute", preliminary: false },
  { id: "aria-hidden-named-region", label: "aria-hidden 이름 있는 영역", mechanism: "attribute", preliminary: false },
  { id: "inert-ancestor", label: "inert 조상", mechanism: "attribute", preliminary: true },
  { id: "modal-inert-aria-hidden", label: "모달 + 배경 inert·aria-hidden", mechanism: "attribute", preliminary: true },
  { id: "native-dialog-showmodal", label: "네이티브 dialog.showModal()", mechanism: "attribute", preliminary: true },
  { id: "display-none", label: "display:none", mechanism: "render", preliminary: true },
  { id: "visibility-hidden", label: "visibility:hidden", mechanism: "render", preliminary: true },
  { id: "opacity-0", label: "opacity:0", mechanism: "visual", preliminary: true },
  { id: "covered-by-overlay", label: "오버레이로 가림", mechanism: "visual", preliminary: true },
  { id: "aria-modal-only", label: "aria-modal만 있는 모달", mechanism: "visual", preliminary: true },
  { id: "hidden-attribute", label: "hidden 속성", mechanism: "render", preliminary: false },
  { id: "offscreen", label: "화면 밖 배치", mechanism: "visual", preliminary: false },
  { id: "closed-details", label: "닫힌 details", mechanism: "render", preliminary: false },
  { id: "inactive-tabpanel", label: "비활성 탭 패널", mechanism: "render", preliminary: false },
  { id: "popover", label: "닫힌 popover", mechanism: "render", preliminary: false },
];
