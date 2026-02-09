#!/usr/bin/env python3
"""ManageSkillScannerAllowlist

Root-level helper for maintaining skill-scanner allowlist policies.

Default target policy file:
  <repo>/.opencode/skills/skill-security-vetting/Data/allowlist.json
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any


def repo_root_from_tool() -> Path:
    # .../.opencode/skills/create-skill/Tools/ManageSkillScannerAllowlist.py
    return Path(__file__).resolve().parents[4]


def default_policy_path() -> Path:
    return (
        repo_root_from_tool()
        / ".opencode/skills/skill-security-vetting/Data/allowlist.json"
    )


def parse_date(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def load_policy(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "version": 1,
            "description": "PAI scanner allowlist. Fix-before-mute applies: only context-justified suppressions with expiry.",
            "rules": [],
        }

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("Invalid allowlist JSON: root must be an object")
    if "rules" not in payload or not isinstance(payload["rules"], list):
        raise SystemExit("Invalid allowlist JSON: 'rules' must be an array")
    return payload


def save_policy(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload["rules"] = sorted(
        payload.get("rules", []),
        key=lambda r: (
            str(r.get("skill", "")),
            str(r.get("rule_id", "")),
            str(r.get("id", "")),
        ),
    )
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def find_rule_index(rules: list[dict[str, Any]], rule_id: str) -> int | None:
    for idx, rule in enumerate(rules):
        if rule.get("id") == rule_id:
            return idx
    return None


def cmd_list(args: argparse.Namespace) -> int:
    policy = load_policy(args.file)
    rules = policy.get("rules", [])

    now = datetime.now()
    shown = 0
    for rule in rules:
        if args.skill and rule.get("skill") != args.skill:
            continue
        if not args.include_disabled and rule.get("enabled", True) is False:
            continue

        exp = rule.get("expires_at")
        expired = False
        if exp:
            try:
                expired = parse_date(exp) < now
            except ValueError:
                expired = True

        status = "enabled" if rule.get("enabled", True) else "disabled"
        if expired:
            status += ",expired"

        print(f"- {rule.get('id')} [{status}]")
        print(
            f"  skill={rule.get('skill')} rule_id={rule.get('rule_id')} analyzer={rule.get('analyzer')}"
        )
        if rule.get("file_path"):
            print(f"  file_path={rule.get('file_path')}")
        print(f"  owner={rule.get('owner')} expires_at={rule.get('expires_at')}")
        print(f"  reason={rule.get('reason')}")
        shown += 1

    print(f"\nListed {shown} rule(s) from {args.file}")
    return 0


def cmd_upsert(args: argparse.Namespace) -> int:
    parse_date(args.expires_at)

    policy = load_policy(args.file)
    rules: list[dict[str, Any]] = policy["rules"]

    entry: dict[str, Any] = {
        "id": args.id,
        "enabled": not args.disabled,
        "skill": args.skill,
        "rule_id": args.rule_id,
        "reason": args.reason,
        "owner": args.owner,
        "created_at": args.created_at or today(),
        "expires_at": args.expires_at,
    }

    optional_fields = {
        "analyzer": args.analyzer,
        "file_path": args.file_path,
        "title_contains": args.title_contains,
        "severity": args.severity,
    }
    for k, v in optional_fields.items():
        if v:
            entry[k] = v

    existing = find_rule_index(rules, args.id)
    if existing is None:
        rules.append(entry)
        action = "added"
    else:
        # Preserve created_at on update unless explicitly supplied.
        if not args.created_at:
            entry["created_at"] = rules[existing].get("created_at", today())
        rules[existing] = entry
        action = "updated"

    save_policy(args.file, policy)
    print(f"{action}: {args.id}")
    print(f"policy: {args.file}")
    return 0


def cmd_disable(args: argparse.Namespace) -> int:
    policy = load_policy(args.file)
    rules: list[dict[str, Any]] = policy["rules"]
    idx = find_rule_index(rules, args.id)
    if idx is None:
        raise SystemExit(f"Rule not found: {args.id}")

    rules[idx]["enabled"] = False
    if args.expires_at:
        parse_date(args.expires_at)
        rules[idx]["expires_at"] = args.expires_at
    if args.reason:
        rules[idx]["reason"] = args.reason

    save_policy(args.file, policy)
    print(f"disabled: {args.id}")
    print(f"policy: {args.file}")
    return 0


def cmd_prune_expired(args: argparse.Namespace) -> int:
    policy = load_policy(args.file)
    rules: list[dict[str, Any]] = policy["rules"]
    now = datetime.now()
    kept: list[dict[str, Any]] = []
    removed = 0

    for rule in rules:
        exp = rule.get("expires_at")
        if not exp:
            kept.append(rule)
            continue
        try:
            if parse_date(exp) < now:
                removed += 1
                continue
        except ValueError:
            removed += 1
            continue
        kept.append(rule)

    policy["rules"] = kept
    save_policy(args.file, policy)
    print(f"pruned expired rules: {removed}")
    print(f"policy: {args.file}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage skill-scanner allowlist policy"
    )
    parser.add_argument(
        "--file",
        type=Path,
        default=default_policy_path(),
        help=f"Allowlist JSON file (default: {default_policy_path()})",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List allowlist rules")
    p_list.add_argument("--skill", help="Filter by skill name")
    p_list.add_argument(
        "--include-disabled", action="store_true", help="Include disabled rules"
    )
    p_list.set_defaults(func=cmd_list)

    p_upsert = sub.add_parser("upsert", help="Add or update a rule by id")
    p_upsert.add_argument("--id", required=True, help="Unique rule id")
    p_upsert.add_argument("--skill", required=True, help="Skill name")
    p_upsert.add_argument("--rule-id", required=True, help="Scanner rule id")
    p_upsert.add_argument("--reason", required=True, help="Suppression rationale")
    p_upsert.add_argument("--owner", required=True, help="Owner of this suppression")
    p_upsert.add_argument("--expires-at", required=True, help="Expiry date YYYY-MM-DD")
    p_upsert.add_argument(
        "--created-at", help="Created date YYYY-MM-DD (defaults to today)"
    )
    p_upsert.add_argument("--analyzer", help="Optional analyzer filter")
    p_upsert.add_argument(
        "--file-path", help="Optional relative/absolute file path filter"
    )
    p_upsert.add_argument("--title-contains", help="Optional title substring filter")
    p_upsert.add_argument("--severity", help="Optional severity filter")
    p_upsert.add_argument(
        "--disabled", action="store_true", help="Create rule in disabled state"
    )
    p_upsert.set_defaults(func=cmd_upsert)

    p_disable = sub.add_parser("disable", help="Disable an existing rule")
    p_disable.add_argument("--id", required=True, help="Rule id")
    p_disable.add_argument("--reason", help="Optional replacement reason")
    p_disable.add_argument("--expires-at", help="Optional expiry date YYYY-MM-DD")
    p_disable.set_defaults(func=cmd_disable)

    p_prune = sub.add_parser("prune-expired", help="Remove expired rules")
    p_prune.set_defaults(func=cmd_prune_expired)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
