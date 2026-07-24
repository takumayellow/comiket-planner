"""comiket_planner: 行きたいサークルのリストから最適な巡回順を導くツール。

公開 API:
    load_layout()          会場レイアウト (ブロック配置・座標モデル) を読む
    Layout.locate(...)     ブロック記号+番号 -> 会場内座標
    parse_placements(...)  「西あ36a」等のテキストを構造化
    plan_route(...)        優先度・売り切れ減衰を考慮した巡回順を計算
"""

from .layout import Layout, load_layout
from .catalog import Placement, parse_placement, parse_placements
from .router import RouteStop, RoutePlan, plan_route

__all__ = [
    "Layout", "load_layout",
    "Placement", "parse_placement", "parse_placements",
    "RouteStop", "RoutePlan", "plan_route",
]
