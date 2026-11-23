# agent-a11y-gap

브라우저 MCP가 에이전트에게 주는 페이지 스냅샷과, 사람·스크린 리더가 받는 접근성 트리가 어디서 갈라지는지 측정한다.
그 차이가 에이전트 실패로 이어지는지, 사람과 에이전트 모두에게 맞는 모달 설계가 무엇인지 확인한다.

<img src="report/figures/layer1-matrix.png" width="720" alt="숨김 패턴 16종과 도구 4종의 노출 상태 히트맵. 속성으로 숨긴 패턴 6개에서 Playwright MCP 스냅샷만 사람 기준과 다르고, 그중 2개에만 aria-hidden 표시가 있다">

**사람에게 숨긴 버튼이 Playwright MCP 스냅샷에는 16개 패턴 중 6개에서 남고, 에이전트가 `[aria-hidden]` 표시로 알아챌 수 있는 것은 그중 2개뿐이다. 같은 Chrome을 읽는 Chrome DevTools MCP는 16개 모두 사람 기준과 같다.**

## 왜 시작했나

[IntentGuard](https://github.com/leeeeeseojin/intentguard)에서 MY DUGOUT 설정 시트를 표준대로 고쳤다.
`aria-modal`, 배경 `inert`·`aria-hidden`, Esc 닫기를 넣었고, 사람 기준 E2E 5개가 모두 통과했다.
그런데 에이전트 성공은 6/8에서 6/8로 그대로였다. 수정 후 스냅샷에 시트 뒤 버튼이 이름만 빠진 채 남아 있었다.

```yaml
- button [ref=e54] [cursor=pointer]: 경기 시작
- dialog "경기 운영 설정" [active] [ref=e58]:
```

에이전트는 e54를 누르려다 시간 초과를 겪었고, 경기를 시작하지 못한 채 `RESULT: confirmed`라고 보고했다.
이 사례 하나를 패턴 단위의 측정으로 넓힌 것이 이 레포다. 기록 발췌와 그때 생긴 질문은 [docs/origin.md](docs/origin.md)에 있다.

## 연구 질문

| | 질문 | 상태 |
| --- | --- | --- |
| RQ1 | 브라우저 MCP 스냅샷은 어떤 숨김 패턴에서 표준 접근성 트리와 다른가? | 1층 완료 |
| RQ2 | 그 차이가 에이전트의 성공률, 거짓 성공 보고, 턴 수에 영향을 주는가? | 2층 완료. 행동(막힌 클릭)에는 영향, 성공률에는 차이 없음 |
| RQ3 | 사람과 에이전트 모두에게 배경을 숨기는 설계는 무엇인가? | LLM 없는 부분 완료 |

계획 전체는 [docs/plan.md](docs/plan.md)에 있다.

## 지금까지의 결과

측정 환경은 @playwright/mcp 0.0.86, chrome-devtools-mcp 1.13.0, Playwright 1.65.1, Chrome 157(headless, Windows 11)이다.
같은 조건으로 두 번 돌려 결과가 같음을 확인했고, CI(Linux, Chrome 158)에서도 달라진 칸이 없었다.

### 1층: 어긋나는 곳은 속성으로 숨긴 패턴뿐이다

사람 기준(Chrome 접근성 트리)에서는 숨겨졌는데 도구에는 보이는 칸만 모았다. 클릭은 도구가 준 ref를 그대로 눌렀을 때 서버에 남은 결과다.

| 패턴 | Playwright MCP 스냅샷 | `[aria-hidden]` 표시 | ref 클릭 | getByRole | DevTools MCP |
| --- | --- | --- | --- | --- | --- |
| aria-hidden 조상 div | `button [ref=e5]: TARGET` (이름 없음) | **없음** | **눌림** | 숨김 | 숨김 |
| aria-hidden 버튼 자체 | `button [aria-hidden] [ref=e4]: TARGET` | 있음 | **눌림** | 숨김 | 숨김 |
| aria-hidden 이름 있는 영역 | `region [aria-hidden]` 아래 `button [ref=e5]: TARGET` | 있음 (영역 줄) | **눌림** | 숨김 | 숨김 |
| inert 조상 | `button "TARGET"` | 없음 | 시간 초과 (`element is inert`) | 노출 | 숨김 |
| 모달 + 배경 inert·aria-hidden | `button [ref=e4]: TARGET` (이름 없음) | **없음** | 시간 초과 (`element is inert`) | 숨김 | 숨김 |
| 네이티브 `dialog.showModal()` | `button "TARGET"` | 없음 | 가로막힘 | 노출 | 숨김 |

- CSS로 렌더를 막은 패턴(display:none, visibility:hidden, `hidden`, 닫힌 details·popover, 비활성 탭)은 네 도구가 모두 같다.
- aria-hidden 버튼은 세 패턴 모두 스냅샷에 남을 뿐 아니라 **실제로 눌린다.** 스크린 리더 사용자는 모르는 버튼을 에이전트는 조작할 수 있다.
- 시각적으로만 가린 패턴(오버레이, aria-modal만)에서 DevTools MCP는 `Successfully clicked on the element`라고 답하지만 클릭은 일어나지 않았다.
  사람 기준에서도 보이는 버튼이라 격차는 아니지만, 거짓 성공 보고로 이어질 수 있는 경로다.
- inert 조상과 네이티브 dialog 밖 버튼이 남는 것은 버그가 아니라 Playwright 1.65에서 정한 동작이다.
  이슈 [#36938](https://github.com/microsoft/playwright/issues/36938)은 PR [#43211](https://github.com/microsoft/playwright/pull/43211)로
  닫혔고, 1.65 API 리뷰 [#43792](https://github.com/microsoft/playwright/issues/43792)에서 로케이터와 ARIA 스냅샷은 이런 요소를
  걸러내지 않고 클릭할 때 `element is inert`로 기다리도록 정리됐다. 위 표의 시간 초과가 바로 이 대기다.
  그래서 사람 기준과의 격차는 Playwright의 의도된 설계에서 나온다.
- aria-hidden 요소가 AI 스냅샷에 남는 것도 의도된 동작이다. PR [#42268](https://github.com/microsoft/playwright/pull/42268)은
  AI 모드 스냅샷이 눈에 보이는 aria-hidden 요소를 일부러 포함한다고 밝히고, 대신 `getByRole`로는 찾을 수 없다는 뜻으로
  `[aria-hidden]` 표시를 붙였다. 그런데 aria-hidden 패턴 세 개를 나란히 놓으면 이 표시는 속성이 붙은 요소가 스냅샷에 남을 때만 보인다.
  속성이 이름 없는 조상 div에 있으면 스냅샷을 줄이는 과정([#41604](https://github.com/microsoft/playwright/pull/41604))에서
  그 div가 접히면서 표시도 함께 사라진다.
- 모달 배경을 숨기는 흔한 방식(`#root`에 aria-hidden)이 바로 이 경우다. MY DUGOUT 수정본의 `button [ref=e54]: 경기 시작`에
  아무 표시가 없었던 이유도 이것이다. 이 표시 누락을 다룬 이슈는 playwright와 playwright-mcp에서 찾지 못했고,
  재현 페이지는 `cases/patterns/aria-hidden-*.html` 세 개다.
- 표시는 자식이 하나뿐인 aria-hidden div가 스냅샷을 줄이는 단계(`unwrapSingleChildGenerics`)에서 펼쳐질 때 버려진다.
  Playwright에서 고치는 방법 두 가지와, 그 전에 화면 코드에서 할 수 있는 우회 두 가지를 검증해 [docs/aria-hidden-mark.md](docs/aria-hidden-mark.md)에 정리했다.

→ [analysis/01_snapshot_matrix.ipynb](analysis/01_snapshot_matrix.ipynb) · [원본 스냅샷](runs/layer1/)

### 3층: 사람 기준을 지키는 구현 중 에이전트에게도 배경을 숨기는 것은 D뿐이다

MY DUGOUT 홈과 설정 시트를 줄인 화면에 모달 구현 네 가지를 적용하고, 시트가 열린 상태에서 쟀다.
배경에는 시트의 "저장"과 같은 이름의 "저장"(로스터) 버튼을 일부러 두었다.

| 구현 | 사람 기준 (배경 숨김 · 포커스 가둠 · Esc 복귀) | Playwright MCP의 배경 "경기 시작" | "저장" 버튼 수 |
| --- | --- | --- | --- |
| A aria-modal만 | 미달 (배경 노출, 포커스 탈출) | 이름까지 노출, 가로막힘 | 2 |
| B 배경 inert + aria-hidden | 통과 | `button [ref=e7]: 경기 시작`, 시간 초과 | 2 |
| C 네이티브 dialog | 통과 | 이름까지 노출, 가로막힘 | 2 |
| D 배경 언마운트 | 통과 | 숨김 | 1 |

B는 MY DUGOUT 수정본과 같은 구조이고, 스냅샷 형태와 시간 초과까지 그때의 기록과 같게 재현됐다.
DevTools MCP에서는 B·C·D가 모두 배경을 숨긴다. D의 비용은 설정을 고르는 동안 뒤 화면의 맥락을 볼 수 없다는 것인데,
사람 참가자 없이는 잴 수 없어 한계로 남긴다.

→ [analysis/02_agent_runs.ipynb](analysis/02_agent_runs.ipynb) · [e2e/modal.spec.ts](e2e/modal.spec.ts)

### IntentGuard 기록 재집계

IntentGuard README의 수치를 이 레포의 pandas 파이프라인으로 다시 계산했고, 모두 같게 나왔다.
통제 실험 90회의 확인된 성공(MCP 22/30, Web v1 16/30, Web v2 30/30)과 평균 턴, 모델 4종 80회의 확인된 성공(v1 20/40 → v2 33/40),
MY DUGOUT 수정 전후 16회의 성공(6/8 → 6/8)이 모두 원래 수치와 같다.
MY DUGOUT 실패 2회의 내용은 수정 전후로 달랐다. 수정 후에는 설정 저장은 채웠지만, 수정 전에는 없던
"스냅샷의 배경 ref를 눌렀다가 기다리다 끝남"이 생겼다.

→ [analysis/03_intentguard_reanalysis.ipynb](analysis/03_intentguard_reanalysis.ipynb)

### 2층: 격차는 에이전트의 행동을 바꾸지만, 결과(성공률)는 바꾸지 않았다

과제 4개 × 구현 B·D × 모델 3 × 2회, 48회다. 채점은 화면이 서버에 올린 상태로 했다.
모델 사용량 한도 때문에 Gemini는 Antigravity CLI로, GPT-OSS와 Sonnet은 OpenAI 호환 API 실행기로 돌렸다.

| 모델 (실행기) | 구현 | 확인된 성공 | 거짓 성공 | 막힌 클릭 | 턴 중앙값 |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.8 Flash (Antigravity) | B | 8/8 | 0 | 0 | 10.5 |
| | D | 8/8 | 0 | 0 | 9.5 |
| GPT-OSS 120B (API) | B | 7/8 | **1** | **1** | 11 |
| | D | 8/8 | 0 | 0 | 8.5 |
| Claude Sonnet 5.5 (API) | B | 8/8 | 0 | 0 | 6 |
| | D | 8/8 | 0 | 0 | 6 |

- Gemini와 Sonnet은 배경이 스냅샷에 남는 B에서도 한 번도 실패하지 않았다.
- 문제는 GPT-OSS의 B에서만 났다. 한 번은 시트의 저장을 찾다가 배경의 `button [ref=e13]: 저장`을 눌러
  `element is inert` 대기로 시간 초과가 났고, 다시 찾아 회복했다. 1층에서 본 동작이 실제 에이전트에게 그대로 일어났다.
- 거짓 성공 한 번은 시트를 닫은 뒤 배경의 같은 이름 "저장"을 누르고 "RESULT: confirmed"라고 보고한 경우다.
  숨긴 요소가 노출되어 생긴 실패가 아니라, 같은 화면에 같은 이름의 버튼이 둘 있어서 생긴 실패다.
- GPT-OSS는 스냅샷 25번 중 15번을 파일로 저장해 내용을 받지 않고, `browser_find`로 글자를 찾아 조작했다.
  격차가 모델에게 닿는 경로가 모델마다 다르다.

구현별 8회로는 판단할 수 없어서, GPT-OSS만 두 과제("설정 바꾸고 시작", "같은 이름 저장")의 B·D를 10회씩으로 늘렸다.

| GPT-OSS 120B, 두 과제 합계 | B | D | Fisher p |
| --- | --- | --- | --- |
| 확인된 성공 | 16/20 | 15/20 | 1.00 |
| 거짓 성공 | 3/20 | 1/20 | 0.61 |
| 배경 버튼에서 막힌 클릭이 있었던 실행 | **5/20** | **0/20** | 0.047 |

- 성공률은 B와 D가 같았다. "설정 바꾸고 시작"에서는 오히려 D가 6/10으로 더 낮았는데, D의 실패 네 건에는
  배경 버튼을 누른 흔적이 없다. 공격 작전을 저장하지 못하거나 60턴 한도까지 헤맨 경우다.
- 배경 버튼을 눌러 막힌 실행은 B에서만 나왔다. 대부분은 다시 찾아 회복했지만, 한 번은 막힌 뒤 예전 ref를 거듭 누르다
  설정을 저장하지 않고 경기를 시작하고 "저장한 뒤 시작했다"고 보고했다. MY DUGOUT에서 본 실패와 같은 모양이다.
  p = 0.047은 같은 표본에 검정을 세 번 한 값이라(보정하면 0.14) 방향만 읽는다.
- GPT-OSS의 실패 상당수는 화면과 상관없는 습관(없는 도구 호출, 예전 ref 재사용, 스냅샷 파일 저장)에서 왔다.
  격차가 결과에 주는 영향이 있더라도 이 잡음보다 작다.

→ [analysis/02_agent_runs.ipynb](analysis/02_agent_runs.ipynb)

## 실행

Node 22, pnpm, 설치된 Chrome 안정판, Python 3.12가 필요하다.

```bash
pnpm install
pnpm test                 # 스냅샷 판정·과제 채점 단위 테스트
pnpm test:e2e             # 모달 구현 A~D 사람 기준 E2E
pnpm probe                # 1층: 패턴 16 × 도구 4 → runs/layer1/
pnpm probe:design         # 3층: 구현 A~D 표 → runs/layer3/
pnpm bench --model claude-haiku-5-5 --impl B --task settings-then-start --reps 1   # 2층 (모델 비용 발생)
pnpm bench --agent antigravity --model gpt-oss-120b-medium --impl B --reps 1       # 2층, Antigravity CLI로
pnpm bench --agent api --model openai/gpt-oss-120b --impl B --reps 1              # 2층, OpenAI 호환 API로 (키는 .env)
pnpm import:intentguard --from ../intentguard
```

노트북은 `analysis/`에서 실행한다.

```bash
python -m venv .venv && .venv/Scripts/pip install -r analysis/requirements.txt
cd analysis && ../.venv/Scripts/jupyter nbconvert --to notebook --execute --inplace 01_snapshot_matrix.ipynb
```

`pnpm serve`로 테스트 페이지를 띄우면 브라우저에서 직접 볼 수 있다.

## 구조

```
cases/
  patterns/       숨김 패턴 16종. 페이지마다 숨겨야 할 버튼 TARGET 하나
  modal/          모달 구현 A~D를 ?impl=로 바꾸는 비교 화면
  patterns.ts     패턴 목록
probe/            LLM 없이 도는 측정 (1·3층)
  tools/          도구 하나당 파일 하나: CDP 트리, getByRole, Playwright MCP, DevTools MCP
  lib/            MCP 연결, 브라우저·버전
  human.ts        사람 기준 검사 (E2E와 공유)
  layer1.ts       1층 실행기
  layer3.ts       3층 실행기
  aria-hidden-mark.ts  구조별 [aria-hidden] 표시 확인
  serve.ts        테스트 페이지 서버. 클릭과 화면 상태를 기록한다
bench/            에이전트 과제와 실행기 (2층)
e2e/              사람 기준 E2E (Playwright Test)
tests/            단위 테스트 (Vitest)
runs/             실행 원본 기록. 버전 조합별 폴더
analysis/         Python 노트북 01~03과 IntentGuard 기록 CSV
report/           리포트와 그림
docs/             출발점, 연구 계획, [aria-hidden] 표시 누락 분석
```

## 한계

- 결과는 위 버전 조합에서의 값이다. CI가 매주 최신 MCP 버전으로 1층을 다시 돌려 달라진 칸을 남긴다(Linux에서 돌아서 Windows 결과와 다를 수 있다).
- 에이전트 실행은 조건당 반복이 적어 모델 순위나 정확한 성공률로 읽지 않는다.
- 2층은 모델마다 실행기가 다르다. 특히 GPT-OSS는 MY DUGOUT에서 실패한 Antigravity가 아니라 API 실행기로 돌렸으므로,
  시스템 지시와 쓸 수 있는 도구가 그때와 다르다.
- 사람 참가자가 없다. "사람 기준"은 Chrome 접근성 트리와 키보드 동작으로 대신했다.
