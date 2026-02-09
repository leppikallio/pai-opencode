#!/usr/bin/env python3
"""AdjudicateFindingsWithOpencode

Phase 2 triage tool: convert skill-scanner findings into structured adjudication
using `opencode run` as the LLM execution path.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Adjudicate skill-scanner findings with opencode"
    )
    parser.add_argument(
        "--scan-report",
        required=True,
        help="Path to skill-scanner report.json",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory for adjudication artifacts (default: sibling triage folder)",
    )
    parser.add_argument(
        "--model",
        default="openai/gpt-5.2",
        help="OpenCode model id (default: openai/gpt-5.2)",
    )
    parser.add_argument(
        "--agent",
        help="Optional OpenCode agent name",
    )
    parser.add_argument(
        "--max-findings",
        type=int,
        default=100,
        help="Maximum findings to adjudicate in one run (default: 100)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=240,
        help="Timeout for opencode run call (default: 240)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print command/prompt metadata without invoking opencode",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail if structured adjudication JSON cannot be extracted",
    )
    return parser.parse_args()


def severity_rank(value: str) -> int:
    order = {
        "CRITICAL": 0,
        "HIGH": 1,
        "MEDIUM": 2,
        "LOW": 3,
        "INFO": 4,
        "SAFE": 5,
    }
    return order.get(str(value).upper(), 99)


def load_findings(
    report_path: Path, max_findings: int
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(report_path.read_text(encoding="utf-8"))

    results = payload.get("results", [])
    findings: list[dict[str, Any]] = []

    for result in results:
        skill_name = result.get("skill_name")
        skill_path = result.get("skill_path") or result.get("skill_directory")
        for finding in result.get("findings", []):
            findings.append(
                {
                    "finding_id": finding.get("id"),
                    "skill": skill_name,
                    "skill_path": skill_path,
                    "rule_id": finding.get("rule_id"),
                    "severity": finding.get("severity"),
                    "category": finding.get("category"),
                    "title": finding.get("title"),
                    "description": finding.get("description"),
                    "file_path": finding.get("file_path"),
                    "line_number": finding.get("line_number"),
                    "analyzer": finding.get("analyzer"),
                    "remediation": finding.get("remediation"),
                }
            )

    findings.sort(
        key=lambda f: (
            severity_rank(str(f.get("severity", ""))),
            str(f.get("skill", "")),
            str(f.get("rule_id", "")),
        )
    )

    if max_findings > 0:
        findings = findings[:max_findings]

    return payload, findings


def build_prompt(report_path: Path, findings: list[dict[str, Any]]) -> str:
    schema = {
        "schema_version": "1.0",
        "summary": {
            "total_reviewed": "number",
            "verdict_counts": {
                "true_positive": "number",
                "likely_false_positive": "number",
                "needs_review": "number",
            },
            "action_counts": {
                "fix_now": "number",
                "deferred_fix": "number",
                "tuned_rule": "number",
                "needs_human_review": "number",
            },
        },
        "items": [
            {
                "finding_id": "string",
                "skill": "string",
                "rule_id": "string",
                "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
                "verdict": "true_positive|likely_false_positive|needs_review",
                "confidence": "0.0-1.0",
                "exploitability": "low|medium|high",
                "impact": "low|medium|high|critical",
                "action": "fix_now|deferred_fix|tuned_rule|needs_human_review",
                "remediation": "string",
                "rationale": "string",
            }
        ],
    }

    return (
        "You are a security adjudication assistant.\n"
        "Do NOT call any tools. Produce the response directly in a single assistant message.\n"
        "Analyze the provided scanner findings and produce structured triage.\n"
        "Apply this policy order strictly:\n"
        "1) fix real issues first\n"
        "2) keep exploitable findings active\n"
        "3) tune rules only for non-exploitable contextual noise\n\n"
        "Input source: attached report file and findings excerpt below.\n"
        f"Report path: {report_path}\n\n"
        "Required output schema (JSON object):\n"
        f"{json.dumps(schema, indent=2)}\n\n"
        "Findings excerpt:\n"
        f"{json.dumps(findings, indent=2)}\n\n"
        "Return your final JSON wrapped EXACTLY in these tags:\n"
        "<ADJUDICATION_JSON>\n"
        "{ ... valid JSON ... }\n"
        "</ADJUDICATION_JSON>\n"
        "Do not include markdown code fences inside those tags."
    )


def run_opencode(
    prompt: str, report_path: Path, model: str, agent: str | None, timeout_seconds: int
) -> tuple[int, str, str]:
    cmd = [
        "opencode",
        "run",
        "--format",
        "json",
        "--title",
        "Skill Security Triage",
        "--model",
        model,
    ]
    if agent:
        cmd.extend(["--agent", agent])

    cmd.extend(["--file", str(report_path), "--", prompt])

    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def extract_text_from_events(stdout: str) -> str:
    texts: list[str] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "text":
            part = event.get("part") or {}
            text = part.get("text")
            if isinstance(text, str) and text:
                texts.append(text)
    return "\n".join(texts)


def extract_adjudication_json(text: str) -> dict[str, Any] | None:
    tag_match = re.search(
        r"<ADJUDICATION_JSON>\s*(\{.*?\})\s*</ADJUDICATION_JSON>",
        text,
        re.DOTALL,
    )
    if tag_match:
        try:
            return json.loads(tag_match.group(1))
        except json.JSONDecodeError:
            pass

    fence_match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            pass

    return None


def summarize_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    verdict_counts = Counter(str(i.get("verdict", "needs_review")) for i in items)
    action_counts = Counter(str(i.get("action", "needs_human_review")) for i in items)
    return {
        "total_reviewed": len(items),
        "verdict_counts": {
            "true_positive": verdict_counts.get("true_positive", 0),
            "likely_false_positive": verdict_counts.get("likely_false_positive", 0),
            "needs_review": verdict_counts.get("needs_review", 0),
        },
        "action_counts": {
            "fix_now": action_counts.get("fix_now", 0),
            "deferred_fix": action_counts.get("deferred_fix", 0),
            "tuned_rule": action_counts.get("tuned_rule", 0),
            "needs_human_review": action_counts.get("needs_human_review", 0),
        },
    }


def render_action_markdown(items: list[dict[str, Any]]) -> str:
    grouped: dict[str, list[dict[str, Any]]] = {
        "fix_now": [],
        "deferred_fix": [],
        "tuned_rule": [],
        "needs_human_review": [],
    }
    for item in items:
        key = str(item.get("action", "needs_human_review"))
        grouped.setdefault(key, []).append(item)

    lines: list[str] = []
    lines.append("# Security Triage Action List")
    lines.append("")
    lines.append(f"Generated: {datetime.now().isoformat()}")
    lines.append("")

    for section in ["fix_now", "deferred_fix", "tuned_rule", "needs_human_review"]:
        lines.append(f"## {section}")
        entries = grouped.get(section, [])
        if not entries:
            lines.append("- None")
            lines.append("")
            continue
        for item in entries:
            lines.append(
                "- "
                + f"[{item.get('severity')}] {item.get('skill')}::{item.get('rule_id')} "
                + f"(finding={item.get('finding_id')})"
            )
            lines.append(
                f"  - Verdict: {item.get('verdict')} (confidence={item.get('confidence')})"
            )
            lines.append(f"  - Rationale: {item.get('rationale')}")
            lines.append(f"  - Remediation: {item.get('remediation')}")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def main() -> int:
    args = parse_args()

    report_path = Path(args.scan_report).resolve()
    if not report_path.exists():
        raise SystemExit(f"Scan report not found: {report_path}")

    payload, findings = load_findings(report_path, args.max_findings)
    if not findings:
        print("No findings to adjudicate.")
        return 0

    output_dir = (
        Path(args.output_dir).resolve()
        if args.output_dir
        else report_path.parent / f"triage-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    prompt = build_prompt(report_path, findings)

    if args.dry_run:
        print("[dry-run] would invoke opencode adjudication")
        print(f"  model: {args.model}")
        print(f"  findings: {len(findings)}")
        print(f"  output_dir: {output_dir}")
        return 0

    code, stdout, stderr = run_opencode(
        prompt=prompt,
        report_path=report_path,
        model=args.model,
        agent=args.agent,
        timeout_seconds=args.timeout_seconds,
    )

    (output_dir / "opencode-events.jsonl").write_text(stdout, encoding="utf-8")
    (output_dir / "opencode-stderr.log").write_text(stderr, encoding="utf-8")

    if code != 0:
        raise SystemExit(
            f"opencode run failed (exit={code}). See {output_dir / 'opencode-stderr.log'}"
        )

    llm_text = extract_text_from_events(stdout)
    (output_dir / "llm-text-output.txt").write_text(llm_text, encoding="utf-8")

    adjudication = extract_adjudication_json(llm_text)
    if adjudication is None:
        msg = "Could not extract structured adjudication JSON from LLM output"
        if args.strict:
            raise SystemExit(msg)
        adjudication = {
            "schema_version": "1.0",
            "summary": {
                "total_reviewed": len(findings),
                "verdict_counts": {
                    "true_positive": 0,
                    "likely_false_positive": 0,
                    "needs_review": len(findings),
                },
                "action_counts": {
                    "fix_now": 0,
                    "deferred_fix": 0,
                    "tuned_rule": 0,
                    "needs_human_review": len(findings),
                },
            },
            "items": [
                {
                    "finding_id": f.get("finding_id"),
                    "skill": f.get("skill"),
                    "rule_id": f.get("rule_id"),
                    "severity": f.get("severity"),
                    "verdict": "needs_review",
                    "confidence": 0.0,
                    "exploitability": "medium",
                    "impact": "medium",
                    "action": "needs_human_review",
                    "remediation": f.get("remediation") or "Manual review required.",
                    "rationale": msg,
                }
                for f in findings
            ],
        }

    items = adjudication.get("items", [])
    if not isinstance(items, list):
        items = []
    if not adjudication.get("summary"):
        adjudication["summary"] = summarize_items(items)

    adjudication_meta = {
        "source_report": str(report_path),
        "generated_at": datetime.now().isoformat(),
        "model": args.model,
        "agent": args.agent,
        "findings_input_count": len(findings),
        "scan_summary": payload.get("summary", {}),
    }
    adjudication["meta"] = adjudication_meta

    adjudication_path = output_dir / "adjudication.json"
    adjudication_path.write_text(json.dumps(adjudication, indent=2), encoding="utf-8")

    action_list = render_action_markdown(items if isinstance(items, list) else [])
    (output_dir / "prioritized-actions.md").write_text(action_list, encoding="utf-8")

    print("Adjudication artifacts:")
    print(f"  {adjudication_path}")
    print(f"  {output_dir / 'prioritized-actions.md'}")
    print(f"  {output_dir / 'llm-text-output.txt'}")
    print(f"  {output_dir / 'opencode-events.jsonl'}")
    print(f"  {output_dir / 'opencode-stderr.log'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
