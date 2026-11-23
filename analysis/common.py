"""노트북 01~03이 같이 쓰는 경로, 그림 스타일, 통계 함수.

표본이 작아서(조건당 2~30회) 유의성 검정보다 비율과 신뢰구간의 폭을 먼저 본다.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"
DATA = ROOT / "analysis" / "data"
FIGURES = ROOT / "report" / "figures"

# 도구와 패턴은 README·리포트 표와 같은 순서로 둔다. 사람 기준(CDP 트리)을 맨 왼쪽에.
TOOLS = ["cdp-ax-tree", "pw-get-by-role", "pw-mcp-snapshot", "devtools-mcp-snapshot"]
TOOL_LABELS = {
    "cdp-ax-tree": "Chrome AX tree\n(human baseline)",
    "pw-get-by-role": "Playwright\ngetByRole",
    "pw-mcp-snapshot": "Playwright MCP\nsnapshot",
    "devtools-mcp-snapshot": "Chrome DevTools MCP\nsnapshot",
}

# 노출 상태는 순서가 있는 세 단계라 한 가지 색(파랑)의 밝기로만 구분한다.
# 숨김은 "없음"이라 색 대신 회색 바탕.
STATE_COLORS = {"hidden": "#f0efec", "text-only": "#86b6ef", "named": "#1c5cab"}
STATE_LABELS = {"hidden": "hidden", "text-only": "exposed, text only (no name)", "named": "exposed with name"}
INK = "#1b1b1b"
MUTED = "#6b6b68"
BLUE = "#256abf"


def setup_style() -> None:
    """한글 라벨이 깨지지 않게 시스템에 있는 한글 글꼴을 고른다."""
    for name in ["Malgun Gothic", "AppleGothic", "NanumGothic", "Noto Sans CJK KR"]:
        if any(f.name == name for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = name
            break
    plt.rcParams.update(
        {
            "axes.unicode_minus": False,
            "axes.edgecolor": MUTED,
            "axes.labelcolor": INK,
            "xtick.color": INK,
            "ytick.color": INK,
            "figure.dpi": 110,
            "savefig.dpi": 160,
            "savefig.bbox": "tight",
        }
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def exposure_state(row) -> str:
    if not row["exposed"]:
        return "hidden"
    return "named" if row["named"] else "text-only"


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """이항 비율의 Wilson 95% 신뢰구간. n이 작거나 비율이 0·1에 가까워도 구간이 [0, 1]을 벗어나지 않는다."""
    if n == 0:
        return (math.nan, math.nan)
    p = successes / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, center - half), min(1.0, center + half))
