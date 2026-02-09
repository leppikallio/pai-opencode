#!/usr/bin/env python3
"""GenerateSecurityAuditReport

Build a human-readable audit artifact from deterministic scanner outputs
(Phase 1) and optional LLM adjudication outputs (Phase 2).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate skill security audit markdown report"
    )
    parser.add_argument(
        "--raw-report",
        required=True,
        help="Path to raw scan report.json (--no-allowlist run)",
    )
    parser.add_argument(
        "--allowlisted-report", help="Path to allowlisted scan report.json"
    )
    parser.add_argument("--allowlist-summary", help="Path to allowlist-summary.json")
    parser.add_argument(
        "--suppressed-findings", help="Path to suppressed-findings.json"
    )
    parser.add_argument("--adjudication", help="Path to adjudication.json")
    parser.add_argument(
        "--title", default="Skill Security Audit Report", help="Report title"
    )
    parser.add_argument(
        "--output-file", required=True, help="Output markdown file path"
    )
    parser.add_argument(
        "--top-rules", type=int, default=10, help="Number of top rule buckets to show"
    )
    parser.add_argument(
        "--top-findings",
        type=int,
        default=15,
        help="Max findings to list in key findings section",
    )
    return parser.parse_args()


def load_json(path_str: str | None) -> dict[str, Any] | None:
    if not path_str:
        return None
    path = Path(path_str).resolve()
    if not path.exists():
        raise SystemExit(f"File not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def severity_rank(sev: str) -> int:
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4, "SAFE": 5}
    return order.get(str(sev).upper(), 99)


def flatten_findings(report: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in report.get("results", []):
        skill = r.get("skill_name")
        for f in r.get("findings", []):
            out.append(
                {
                    "skill": skill,
                    "finding_id": f.get("id"),
                    "rule_id": f.get("rule_id"),
                    "severity": f.get("severity"),
                    "title": f.get("title"),
                    "description": f.get("description"),
                    "file_path": f.get("file_path"),
                    "line_number": f.get("line_number"),
                    "analyzer": f.get("analyzer"),
                    "remediation": f.get("remediation"),
                }
            )
    return out


def summary_metrics(report: dict[str, Any]) -> dict[str, Any]:
    s = report.get("summary", {})
    sev = s.get("findings_by_severity", {})
    return {
        "total_skills_scanned": int(s.get("total_skills_scanned", 0)),
        "safe_skills": int(s.get("safe_skills", 0)),
        "total_findings": int(s.get("total_findings", 0)),
        "critical": int(sev.get("critical", 0)),
        "high": int(sev.get("high", 0)),
        "medium": int(sev.get("medium", 0)),
        "low": int(sev.get("low", 0)),
        "info": int(sev.get("info", 0)),
        "timestamp": s.get("timestamp"),
    }


def top_rules(findings: list[dict[str, Any]], limit: int) -> list[tuple[str, str, int]]:
    c = Counter((str(f.get("rule_id")), str(f.get("severity"))) for f in findings)
    rows = [(rid, sev, count) for (rid, sev), count in c.items()]
    rows.sort(key=lambda x: (severity_rank(x[1]), -x[2], x[0]))
    return rows[:limit]


def key_findings(findings: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    ordered = sorted(
        findings,
        key=lambda f: (
            severity_rank(str(f.get("severity", ""))),
            str(f.get("skill", "")),
            str(f.get("rule_id", "")),
        ),
    )
    return ordered[:limit]


def adjudication_section(
    adjudication: dict[str, Any] | None,
) -> tuple[list[str], list[dict[str, Any]]]:
    if not adjudication:
        return ["_No adjudication artifact provided._", ""], []

    lines: list[str] = []
    summary = adjudication.get("summary", {})
    items = adjudication.get("items", [])
    if not isinstance(items, list):
        items = []

    lines.append(f"- Total reviewed: {summary.get('total_reviewed', len(items))}")
    verdict_counts = summary.get("verdict_counts", {})
    lines.append(
        "- Verdicts: "
        f"TP={verdict_counts.get('true_positive', 0)}, "
        f"LFP={verdict_counts.get('likely_false_positive', 0)}, "
        f"NeedsReview={verdict_counts.get('needs_review', 0)}"
    )
    action_counts = summary.get("action_counts", {})
    lines.append(
        "- Actions: "
        f"fix_now={action_counts.get('fix_now', 0)}, "
        f"deferred_fix={action_counts.get('deferred_fix', 0)}, "
        f"tuned_rule={action_counts.get('tuned_rule', 0)}, "
        f"needs_human_review={action_counts.get('needs_human_review', 0)}"
    )
    lines.append("")

    return lines, [i for i in items if isinstance(i, dict)]


def actionable_items(
    items: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    fix_like = []
    review_like = []
    for item in items:
        action = str(item.get("action", ""))
        if action in ("fix_now", "deferred_fix", "tuned_rule"):
            fix_like.append(item)
        else:
            review_like.append(item)

    fix_like.sort(
        key=lambda i: (
            severity_rank(str(i.get("severity", ""))),
            str(i.get("skill", "")),
            str(i.get("rule_id", "")),
        )
    )
    review_like.sort(
        key=lambda i: (
            severity_rank(str(i.get("severity", ""))),
            str(i.get("skill", "")),
            str(i.get("rule_id", "")),
        )
    )
    return fix_like, review_like


def build_report(
    title: str,
    raw_report: dict[str, Any],
    allowlisted_report: dict[str, Any] | None,
    allowlist_summary: dict[str, Any] | None,
    suppressed_findings: dict[str, Any] | None,
    adjudication: dict[str, Any] | None,
    top_rules_limit: int,
    top_findings_limit: int,
) -> str:
    now = datetime.now().isoformat()
    raw_metrics = summary_metrics(raw_report)
    raw_findings = flatten_findings(raw_report)

    allowlisted_metrics = (
        summary_metrics(allowlisted_report) if allowlisted_report else None
    )
    allowlisted_findings = (
        flatten_findings(allowlisted_report) if allowlisted_report else []
    )

    suppression_count = 0
    if allowlist_summary:
        suppression_count = int(allowlist_summary.get("suppressed_count", 0))
    elif suppressed_findings:
        suppression_count = len(suppressed_findings.get("suppressed_findings", []))

    lines: list[str] = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"Generated: {now}")
    lines.append("")

    lines.append("## Executive Summary")
    lines.append("")
    lines.append(
        f"- Deterministic raw scan: {raw_metrics['total_skills_scanned']} skills, {raw_metrics['total_findings']} findings "
        f"(critical={raw_metrics['critical']}, high={raw_metrics['high']}, medium={raw_metrics['medium']}, info={raw_metrics['info']})."
    )
    if allowlisted_metrics:
        lines.append(
            f"- Allowlisted operational scan: {allowlisted_metrics['total_findings']} findings "
            f"(critical={allowlisted_metrics['critical']}, high={allowlisted_metrics['high']}, medium={allowlisted_metrics['medium']}, info={allowlisted_metrics['info']})."
        )
        lines.append(f"- Suppressed findings (policy-justified): {suppression_count}.")
    lines.append(
        "- Fix-before-mute policy remains in force: real issues should be remediated before rule suppression."
    )
    lines.append("")

    lines.append("## Deterministic Scan Statistics (Phase 1)")
    lines.append("")
    lines.append("### Raw scan")
    lines.append("")
    lines.append(f"- Skills scanned: {raw_metrics['total_skills_scanned']}")
    lines.append(f"- Safe skills: {raw_metrics['safe_skills']}")
    lines.append(f"- Total findings: {raw_metrics['total_findings']}")
    lines.append(
        f"- Severity breakdown: CRITICAL={raw_metrics['critical']}, HIGH={raw_metrics['high']}, "
        f"MEDIUM={raw_metrics['medium']}, LOW={raw_metrics['low']}, INFO={raw_metrics['info']}"
    )
    lines.append("")

    if allowlisted_metrics:
        lines.append("### Allowlisted scan")
        lines.append("")
        lines.append(f"- Skills scanned: {allowlisted_metrics['total_skills_scanned']}")
        lines.append(f"- Safe skills: {allowlisted_metrics['safe_skills']}")
        lines.append(f"- Total findings: {allowlisted_metrics['total_findings']}")
        lines.append(
            f"- Severity breakdown: CRITICAL={allowlisted_metrics['critical']}, HIGH={allowlisted_metrics['high']}, "
            f"MEDIUM={allowlisted_metrics['medium']}, LOW={allowlisted_metrics['low']}, INFO={allowlisted_metrics['info']}"
        )
        lines.append(f"- Policy suppressions applied: {suppression_count}")
        if allowlist_summary:
            lines.append(
                f"- Expired allowlist rules at run time: {int(allowlist_summary.get('expired_rules_count', 0))}"
            )
        lines.append("")

    lines.append("## Top Rule Buckets (Raw)")
    lines.append("")
    for rid, sev, count in top_rules(raw_findings, top_rules_limit):
        lines.append(f"- [{sev}] {rid}: {count}")
    lines.append("")

    lines.append("## Key Findings (Raw, prioritized)")
    lines.append("")
    for f in key_findings(raw_findings, top_findings_limit):
        loc = f.get("file_path") or "<skill-level>"
        if f.get("line_number"):
            loc = f"{loc}:{f.get('line_number')}"
        lines.append(
            f"- [{f.get('severity')}] {f.get('skill')} :: {f.get('rule_id')} @ {loc}"
        )
        lines.append(f"  - Why it matters: {f.get('title')}")
        desc = str(f.get("description") or "").strip()
        if desc:
            lines.append(f"  - Detail: {desc}")
        rem = str(f.get("remediation") or "").strip()
        if rem:
            lines.append(f"  - Suggested remediation: {rem}")
    lines.append("")

    lines.append("## LLM Adjudication (Phase 2)")
    lines.append("")
    adj_lines, adj_items = adjudication_section(adjudication)
    lines.extend(adj_lines)

    fix_items, review_items = actionable_items(adj_items)

    lines.append("### Actionable remediation candidates")
    lines.append("")
    if not fix_items:
        lines.append("- None produced in adjudication artifact.")
    else:
        for item in fix_items[:15]:
            lines.append(
                f"- [{item.get('severity')}] {item.get('skill')}::{item.get('rule_id')} "
                f"({item.get('action')})"
            )
            lines.append(f"  - Recommendation: {item.get('remediation')}")
            lines.append(f"  - Rationale: {item.get('rationale')}")
    lines.append("")

    lines.append("### Needs human review")
    lines.append("")
    if not review_items:
        lines.append("- None")
    else:
        for item in review_items[:10]:
            lines.append(
                f"- [{item.get('severity')}] {item.get('skill')}::{item.get('rule_id')} "
                f"(confidence={item.get('confidence')})"
            )
            lines.append(f"  - Rationale: {item.get('rationale')}")
    lines.append("")

    lines.append("## Confidence Notes")
    lines.append("")
    lines.append(
        "- Deterministic and adjudicated views are both included (raw + allowlisted + LLM triage)."
    )
    lines.append(
        "- Allowlist decisions remain auditable via `suppressed-findings.json` and `allowlist-summary.json`."
    )
    lines.append(
        "- Install-time gate enforcement is available via `Tools/Install.ts --skills-gate-profile ...`."
    )
    lines.append("")

    lines.append("## Recommended Next Actions")
    lines.append("")
    lines.append("1. Execute highest-priority `fix_now` items from adjudication.")
    lines.append("2. Re-run raw scan (`--no-allowlist`) to confirm risk reduction.")
    lines.append("3. Keep allowlist entries narrow, owned, and expiring.")
    lines.append("4. Advance Phase 2 with patch-oriented recommendation generation.")
    lines.append("")

    return "\n".join(lines).replace("\n\n\n", "\n\n")


def main() -> int:
    args = parse_args()

    raw_report = load_json(args.raw_report)
    if not raw_report:
        raise SystemExit("raw report is required and must be valid JSON")

    allowlisted_report = load_json(args.allowlisted_report)
    allowlist_summary = load_json(args.allowlist_summary)
    suppressed_findings = load_json(args.suppressed_findings)
    adjudication = load_json(args.adjudication)

    output_file = Path(args.output_file).resolve()
    output_file.parent.mkdir(parents=True, exist_ok=True)

    content = build_report(
        title=args.title,
        raw_report=raw_report,
        allowlisted_report=allowlisted_report,
        allowlist_summary=allowlist_summary,
        suppressed_findings=suppressed_findings,
        adjudication=adjudication,
        top_rules_limit=args.top_rules,
        top_findings_limit=args.top_findings,
    )

    output_file.write_text(content, encoding="utf-8")
    print(f"Audit report written: {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
