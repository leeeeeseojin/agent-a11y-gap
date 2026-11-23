# 출발점: MY DUGOUT 설정 시트

이 레포는 [IntentGuard](https://github.com/leeeeeseojin/intentguard)에서 MY DUGOUT을 다시 검사하다가 생긴 질문에서 시작했다.
아래 발췌는 그때 남은 실행 기록(`.intentguard/dugout/`)에서 그대로 옮겼다. 줄 수만 줄였다.

## 1. 시트가 열려 있는데 뒤쪽 버튼이 보였다

과제는 "설정을 바꾸고 경기를 시작해줘"였다. 수정 전 빌드에서 시트를 연 뒤 GPT-OSS가 받은 Playwright MCP 스냅샷이다.

```yaml
- button "경기 시작" [ref=e48] [cursor=pointer]
- button "로스터 편집" [ref=e49] [cursor=pointer]
- dialog "경기 운영 설정" [ref=e53]:
    - button "닫기" [ref=e56] [cursor=pointer]: ✕
```

시트 밖의 "경기 시작"이 시트와 같은 높이에 이름까지 붙어 있다. 에이전트는 e48을 눌렀고, 시트 배경에 막혀 기다리다 끝났다.

```
browser_click {"target":"e48"}
TimeoutError: browserBackend.callTool: Timeout 5000ms exceeded.
  - waiting for locator('aria-ref=e48')
```

그리고 마지막 답은 `RESULT: confirmed`였다. 경기는 시작되지 않았다.

시트에는 `aria-modal`도, 배경 `inert`도 없었다. 사람 기준으로도 결함이라 고쳤다.

## 2. 표준대로 고쳤는데 결과가 같았다

설정·선수 시트를 하나의 모달 컴포넌트로 바꾸고, 열리면 `#root`에 `inert`와 `aria-hidden`을 걸었다.
E2E로 Chrome 접근성 트리에서 배경이 사라진 것을 확인했다. 그런데 4개 모델 × 2회를 다시 돌리니 성공은 6/8에서 6/8로 그대로였다.

수정 후 빌드에서 같은 모델이 받은 스냅샷이다.

```yaml
- button [ref=e52] [cursor=pointer]
- button [ref=e54] [cursor=pointer]: 경기 시작
- button [ref=e55] [cursor=pointer]: 로스터 편집
- dialog "경기 운영 설정" [active] [ref=e58]:
    - button "내가" [pressed] [ref=e66] [cursor=pointer]
```

배경 버튼은 사라지지 않았다. 접근성 이름만 빠지고 텍스트(`: 경기 시작`)와 ref는 남았다.
`aria-pressed`를 넣은 덕분에 시트 안의 선택 상태(`[pressed]`)는 보이게 됐고, 실제로 이번에는 설정 저장은 채웠다.
하지만 경기는 여전히 시작하지 못했다.

```
browser_click {"target":"e52"}  →  waiting for locator('aria-ref=e52')  (시간 초과)
browser_click {"target":"e55"}  →  waiting for locator('aria-ref=e55')  (시간 초과)
browser_click {"target":"e54"}  →  waiting for locator('aria-ref=e54')  (시간 초과)
```

수정 전에는 0이던 "스냅샷의 ref를 눌렀는데 그 요소를 기다리다 끝남"이 수정 후 두 실행에서 3회, 1회 생겼다
(`analysis/03_intentguard_reanalysis.ipynb`). 배경을 inert로 막은 결과, 스냅샷에 남은 배경 버튼은 "보이지만 누를 수 없는 것"이 됐다.

## 3. 그래서 생긴 질문

- 사람과 스크린 리더가 받는 트리와 에이전트가 받는 스냅샷은 정확히 어디서 갈라지는가.
  이번 한 번은 `inert` + `aria-hidden` 조합이었다. 다른 숨김 방식은 어떤가. (RQ1, 1층)
- 이 격차가 실패를 만드는가, 아니면 GPT-OSS 한 모델의 문제였나. 다른 세 모델은 같은 스냅샷을 받고도 성공했다. (RQ2, 2층)
- 사람 기준을 지키면서 에이전트에게도 배경을 숨기려면 화면 설계를 어떻게 바꿔야 하는가.
  IntentGuard에서는 "뒤쪽 화면을 실제로 렌더하지 않는 것"까지 생각만 하고, 디자인이 바뀌는 일이라 하지 않았다. (RQ3, 3층)

## 처음 가정과 다른 점

"접근성을 지키면 에이전트도 잘 쓴다"는 가정으로 IntentGuard의 v2 화면을 만들었고, 거기서는 실제로 성공률이 올랐다.
MY DUGOUT에서 이 가정이 깨진 이유는 v2의 개선이 대부분 **보이는 정보를 더하는 것**(버튼 이름, 상태 표시)이었고,
이번 수정은 **보이는 것을 빼는 것**이었기 때문이라고 보고 있다. 더한 정보는 스냅샷에도 들어가지만,
속성으로 뺀 것은 스냅샷에서 빠지지 않을 수 있다. 1층 결과는 이 추측과 맞았다.
