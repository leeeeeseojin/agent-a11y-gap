# `[aria-hidden]` 표시가 사라지는 이유와 고치는 방법

MY DUGOUT 수정본의 스냅샷에서 시트 뒤 버튼은 `button [ref=e54]: 경기 시작`으로만 보였다.
Playwright AI 스냅샷은 aria-hidden 요소에 `[aria-hidden]` 표시를 붙이게 되어 있는데, 이 버튼에는 표시가 없었다.
이 문서는 그 표시가 왜 빠졌는지, Playwright 코드와 화면 코드에서 각각 무엇을 바꾸면 되는지 정리한 것이다.
측정 환경은 Playwright 1.65.1(Playwright MCP 0.0.86이 쓰는 1.66 alpha도 같은 코드)과 Chrome 157이다.

## 배경: 표시는 정해진 동작이다

- AI 모드 스냅샷은 눈에 보이는 aria-hidden 요소를 일부러 포함한다. 대신 `getByRole`로는 찾을 수 없는 요소라는 뜻으로
  `[aria-hidden]` 표시를 붙인다(PR [#42268](https://github.com/microsoft/playwright/pull/42268)).
- 스냅샷이 aria-hidden 요소를 포함하는 것 자체는 바꿀 대상이 아니다. 문제는 일부 구조에서 이 표시가 빠진다는 것이다.
- 1층 결과에서 aria-hidden 버튼은 표시가 있든 없든 ref를 누르면 실제로 눌렸다. 그래서 표시는 에이전트가
  "사람에게 숨겨진 요소"라는 것을 알 수 있는 유일한 단서다.

## 어떤 구조에서 사라지는가

`npx tsx probe/aria-hidden-mark.ts`의 출력이다. 각 구조 앞에는 비교용 CONTROL 버튼이 하나 있다.

| 구조 | AI 스냅샷 | 표시 |
| --- | --- | --- |
| 버튼 자체에 aria-hidden | `button [aria-hidden] [ref]: 경기 시작` | 있음 |
| 조상 div, 자식 1개 | `button [ref]: 경기 시작` | 없음 |
| 조상 div, 자식 2개 | `generic [aria-hidden]` 아래 버튼 두 개 | 있음 |
| `#root` > 래퍼 div (MY DUGOUT 구조) | `generic` 아래 홈 · 경기 시작 · 로스터 편집 | 없음 |

표시가 사라지는 조건은 "aria-hidden이 이름 없는 div에 있고, 그 div의 자식이 하나뿐"인 경우다.
React 앱은 보통 `#root` 안에 앱 래퍼 div 하나만 두므로, `#root`에 aria-hidden을 거는 흔한 모달 처리가 정확히 이 조건에 걸린다.

## 원인: 스냅샷을 줄이는 단계에서 표시를 넘기지 않는다

1. 스냅샷을 만들 때 `aria-hidden="true"` 속성이 직접 붙은 요소에만 `props["aria-hidden"]`이 기록된다.
   자식 요소에는 기록되지 않는다.
2. AI 모드는 스냅샷을 짧게 만들기 위해 여러 단계를 거친다(PR [#41604](https://github.com/microsoft/playwright/pull/41604)).
   그중 `unwrapSingleChildGenerics`는 이름이 없고 자식이 하나뿐인 generic을 펼쳐서 자식만 남긴다.
3. 이때 펼쳐지는 generic의 `props["aria-hidden"]`은 자식에게 넘어가지 않고 버려진다. 표시를 그릴 근거가 없어진 것이다.

`unwrapSingleChildGenerics`의 현재 코드다(playwright-core 1.65.1, 주입 스크립트).

```js
var unwrapSingleChildGenerics = {
  name: "unwrapSingleChildGenerics",
  exit(node, ctx) {
    if (node.role !== "generic" || node.name || node.children.length > 1 || !node.children.every((child) => typeof child !== "string" && !!child.ref))
      return;
    if (!node.children.length && isClickTargetRoot(node, ctx))
      return;
    return "unwrap";
  }
};
```

## Playwright 쪽에서 고치는 방법

`return "unwrap"` 바로 앞에 한 가지를 더하면 된다. 두 방법 모두 설치된 패키지는 건드리지 않고
`.tmp`에 복사한 playwright-core에서 시험했다. aria-hidden이 없는 div의 결과는 두 방법 모두 그대로였다.

### 방법 1. 펼치되 표시를 자식에게 넘긴다

```js
    if (node.props["aria-hidden"] !== void 0)
      for (const child of node.children)
        child.props["aria-hidden"] = node.props["aria-hidden"];
    return "unwrap";
```

| 구조 | 결과 |
| --- | --- |
| 조상 div, 자식 1개 | `button [aria-hidden] [ref]: 경기 시작` |
| `#root` > 래퍼 div | `generic [aria-hidden]` 아래 홈 · 경기 시작 · 로스터 편집 |

### 방법 2. aria-hidden이 붙은 generic은 펼치지 않는다

```js
    if (node.props["aria-hidden"] !== void 0)
      return;
    return "unwrap";
```

| 구조 | 결과 |
| --- | --- |
| 조상 div, 자식 1개 | `generic [aria-hidden]` 아래 `button [ref]: 경기 시작` |
| `#root` > 래퍼 div | `generic [aria-hidden]` 아래 `generic` 아래 버튼들 |

방법 1이 더 자연스럽다고 본다. 스냅샷을 짧게 만든다는 이 단계의 목적을 지키면서, 자식이 하나일 때는
누를 대상 줄에 바로 표시가 붙기 때문이다. 방법 2는 줄이 하나 더 남지만, 표시가 어느 요소에서 왔는지가 원래 DOM과 같게 보인다.

## 화면 쪽에서 지금 할 수 있는 우회

Playwright가 고쳐지기 전에도 aria-hidden을 거는 위치만 바꾸면 표시가 남는다.
MY DUGOUT `src/ui/Sheet.tsx`는 지금 `document.getElementById("root")`에 `inert`와 `aria-hidden`을 건다.

### 우회 1. 자식이 여럿인 요소에 건다

`#root` 대신 앱 래퍼(`#root`의 첫 자식)에 건다.

```
- generic [aria-hidden] [ref]:
  - heading [level=1] [ref]: 홈
  - button [ref]: 경기 시작
  - button [ref]: 로스터 편집
```

코드는 가장 적게 바뀐다. 다만 그 래퍼의 자식이 나중에 하나로 줄면 같은 이유로 표시가 다시 사라진다.

### 우회 2. 시트가 열린 동안만 `#root`에 이름을 붙인다

aria-hidden과 함께 `role="region"`, `aria-label="배경 화면"`을 걸고, 닫을 때 같이 뗀다.

```
- region [aria-hidden] [ref]:
  - generic [ref]:
    - heading [level=1] [ref]: 홈
    - button [ref]: 경기 시작
```

이름 있는 영역은 펼쳐지지 않으므로 앱 구조가 바뀌어도 표시가 남는다. 숨겨져 있는 동안에만 붙어 있으므로
스크린 리더 사용자에게는 이 영역이 드러나지 않는다.

## 한계

- 표시는 단서일 뿐이다. 에이전트가 표시를 보고도 배경 버튼을 누르려 하면 지금처럼 `element is inert`로 기다리다
  시간 초과가 난다. 2층에서 우회 2를 적용한 구현 E를 GPT-OSS로 돌려 보니, 배경 버튼에서 막힌 실행이 B 5/20, E 8/20으로
  줄지 않았다. 모델은 `region [aria-hidden]` 아래 버튼을 보고도 눌렀다. 표시는 숨겨졌다는 정보일 뿐 누르지 말라는 신호로 읽히지 않았다.
- 배경을 에이전트에게서 확실히 숨기는 방법은 3층의 구현 D(배경 언마운트)다. 우회 1·2는 사람 기준 구현(B)을 유지하면서
  에이전트에게 단서를 주는 중간 방법이다.
- 위 결과는 Playwright 1.65.1의 값이다. 1층의 aria-hidden 패턴 세 개(`cases/patterns/aria-hidden-*.html`)를 CI가 매주 다시 돌리므로,
  Playwright가 이 단계를 바꾸면 달라진 칸으로 드러난다.
