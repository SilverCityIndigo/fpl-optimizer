"""Command-line interface for fpl-optimizer.

Usage examples
--------------
# Show optimal squad from scratch:
    fpl-optimizer squad

# Show top 20 players by expected points:
    fpl-optimizer top --n 20

# Captain recommendation only:
    fpl-optimizer captain

# Chip advice:
    fpl-optimizer chips --used wildcard

# Transfer suggestions (given a squad file):
    fpl-optimizer transfers --squad-file my_squad.txt --ft 2
"""

from __future__ import annotations

import argparse
import sys


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fpl-optimizer",
        description="Fantasy Premier League squad optimizer and points predictor.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # --- squad ---
    squad_p = subparsers.add_parser(
        "squad", help="Compute the optimal 15-player squad from scratch."
    )
    squad_p.add_argument(
        "--budget",
        type=float,
        default=100.0,
        help="Budget in millions (default: 100.0).",
    )

    # --- top ---
    top_p = subparsers.add_parser(
        "top", help="Show top players ranked by expected points."
    )
    top_p.add_argument("--n", type=int, default=20, help="Number of players to show.")
    top_p.add_argument(
        "--position",
        choices=["GKP", "DEF", "MID", "FWD"],
        default=None,
        help="Filter by position.",
    )

    # --- captain ---
    subparsers.add_parser(
        "captain",
        help="Show captain and vice-captain recommendations for the optimal squad.",
    )

    # --- chips ---
    chips_p = subparsers.add_parser(
        "chips", help="Show chip recommendations for the current gameweek."
    )
    chips_p.add_argument(
        "--used",
        nargs="*",
        default=[],
        help="Chips already used this season (e.g. --used wildcard free_hit).",
    )
    chips_p.add_argument(
        "--injuries",
        type=int,
        default=0,
        help="Number of squad players who are unavailable/doubtful.",
    )

    # --- transfers ---
    transfers_p = subparsers.add_parser(
        "transfers",
        help="Suggest transfers for an existing squad.",
    )
    transfers_p.add_argument(
        "--ft",
        type=int,
        default=1,
        dest="free_transfers",
        help="Number of free transfers available (default: 1).",
    )
    transfers_p.add_argument(
        "--max",
        type=int,
        default=2,
        dest="max_transfers",
        help="Maximum number of transfers to suggest (default: 2).",
    )

    return parser


def _load_service():
    """Import and load the FPL service (lazy import keeps CLI startup fast)."""
    from fpl_optimizer.service import FPLService

    print("Fetching data from the FPL API…", flush=True)
    svc = FPLService()
    svc.load()
    print(f"Loaded data for Gameweek {svc.current_gameweek}.\n")
    return svc


def cmd_squad(args: argparse.Namespace) -> None:
    svc = _load_service()
    budget_tenths = round(args.budget * 10)
    result = svc.optimal_squad(budget=budget_tenths)
    print(result.display())


def cmd_top(args: argparse.Namespace) -> None:
    svc = _load_service()
    players = svc.top_players(n=args.n, position=args.position)
    pos_label = args.position or "ALL"
    print(f"Top {len(players)} players ({pos_label}) by expected points:\n")
    for i, p in enumerate(players, 1):
        print(f"  {i:2d}. {p.display()}")


def cmd_captain(args: argparse.Namespace) -> None:
    svc = _load_service()
    squad = svc.optimal_squad()
    rec = svc.captain_pick(squad.starting_xi)
    print(rec.display())


def cmd_chips(args: argparse.Namespace) -> None:
    svc = _load_service()
    chips_used: set[str] = set(args.used)
    advice = svc.chip_advice(chips_used=chips_used, squad_injury_count=args.injuries)
    print(advice.display())


def cmd_transfers(args: argparse.Namespace) -> None:
    svc = _load_service()
    # Use optimal squad as the "current squad" for demonstration
    squad = svc.optimal_squad()
    plan, sell_candidates = svc.transfer_plan(
        current_squad=squad.squad,
        free_transfers=args.free_transfers,
        max_transfers=args.max_transfers,
    )
    print("Sell candidates (most urgent first):")
    for sc in sell_candidates:
        print(sc.display())
    print()
    print(plan.display())


_COMMAND_MAP = {
    "squad": cmd_squad,
    "top": cmd_top,
    "captain": cmd_captain,
    "chips": cmd_chips,
    "transfers": cmd_transfers,
}


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = _COMMAND_MAP.get(args.command)
    if handler is None:
        parser.print_help()
        sys.exit(1)
    handler(args)


if __name__ == "__main__":
    main()
