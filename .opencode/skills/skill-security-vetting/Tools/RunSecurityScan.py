#!/usr/bin/env python3
"""RunSecurityScan

Python-native wrapper for PAI skill security scans using the local skill-scanner fork.

Recommended invocation:

  cd /Users/zuul/Projects/skill-scanner
  uv run python /Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py \
    --mode all
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

SCANNER_ROOT = Path("/Users/zuul/Projects/skill-scanner")
DEFAULT_SKILLS_DIR = Path("/Users/zuul/Projects/pai-opencode/.opencode/skills")
ADVISORY_DISABLED_RULES = {"MANIFEST_MISSING_LICENSE"}
GATE_PROFILES = ("advisory", "block-critical", "block-high")
DEFAULT_ALLOWLIST_FILES = [
    Path(
        "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Data/allowlist.json"
    ),
    Path(
        "/Users/zuul/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/skill-security-vetting/allowlist.json"
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PAI skill security scans")
    parser.add_argument(
        "--mode",
        choices=["single", "all", "list"],
        required=True,
        help="Scan one skill or all skills",
    )
    parser.add_argument(
        "--skill-dir",
        action="append",
        default=[],
        help=(
            "Path to one skill directory. For --mode single: provide exactly one. "
            "For --mode list: repeat this flag to scan a subset (optional)."
        ),
    )
    parser.add_argument(
        "--skills-dir",
        default=str(DEFAULT_SKILLS_DIR),
        help=f"Root skills directory for --mode all (default: {DEFAULT_SKILLS_DIR})",
    )
    parser.add_argument(
        "--skill-list-file",
        help=(
            "Path to newline-delimited skill directory paths to scan (optional for --mode list; "
            "can also provide repeated --skill-dir)."
        ),
    )
    parser.add_argument(
        "--output-dir", help="Directory for summary/json/sarif artifacts"
    )
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Exit non-zero for HIGH/CRITICAL findings",
    )
    parser.add_argument(
        "--gate-profile",
        choices=GATE_PROFILES,
        default="advisory",
        help="Gate behavior profile (default: advisory)",
    )
    parser.add_argument(
        "--no-allowlist",
        action="store_true",
        help="Disable allowlist filtering and report all findings",
    )
    parser.add_argument(
        "--allowlist-file",
        action="append",
        default=[],
        help="Additional allowlist JSON file path(s)",
    )
    parser.add_argument(
        "--fail-on-expired-allowlist",
        action="store_true",
        help="Fail when allowlist entries are expired",
    )
    parser.add_argument(
        "--use-opencode-analyzer",
        action="store_true",
        help="Enable native opencode analyzer alongside static/behavioral/trigger",
    )
    parser.add_argument(
        "--opencode-model",
        default="openai/gpt-5.2",
        help="Model for opencode analyzer (default: openai/gpt-5.2)",
    )
    parser.add_argument(
        "--opencode-agent",
        help="Optional OpenCode agent for opencode analyzer",
    )
    parser.add_argument(
        "--opencode-timeout",
        type=int,
        default=120,
        help="Timeout seconds for opencode analyzer (default: 120)",
    )
    parser.add_argument(
        "--opencode-binary",
        default="opencode",
        help="Opencode binary path/name (default: opencode)",
    )
    parser.add_argument(
        "--opencode-debug-dir",
        help="Optional debug directory for opencode analyzer artifacts",
    )
    parser.add_argument(
        "--no-progress",
        dest="show_progress",
        action="store_false",
        help="Disable per-skill progress output",
    )
    parser.add_argument(
        "--progress-interval",
        type=int,
        default=15,
        help="Heartbeat interval seconds while scanning a skill (default: 15)",
    )
    parser.set_defaults(show_progress=True)
    return parser.parse_args()


def resolve_gate_profile(args: argparse.Namespace) -> str:
    """Resolve gate profile, preserving legacy flag compatibility."""
    profile = args.gate_profile

    # Backward compatibility: old flag implied high/critical enforcement.
    if args.fail_on_findings and profile == "advisory":
        profile = "block-high"
        print(
            "[warn] --fail-on-findings is legacy behavior; using gate profile 'block-high'.",
            file=sys.stderr,
        )

    return profile


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _normalize_path(p: str | None) -> str | None:
    if not p:
        return None
    return p.replace("\\", "/")


def resolve_allowlist_files(args: argparse.Namespace) -> list[Path]:
    if args.no_allowlist:
        return []

    files: list[Path] = []
    for p in DEFAULT_ALLOWLIST_FILES:
        if p.exists():
            files.append(p)
    for p in args.allowlist_file:
        candidate = Path(p).resolve()
        if candidate.exists():
            files.append(candidate)
        else:
            raise SystemExit(f"Allowlist file not found: {candidate}")
    return files


def load_allowlist_rules(
    files: list[Path],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    rules: list[dict[str, Any]] = []
    expired: list[dict[str, Any]] = []
    load_messages: list[str] = []

    now = datetime.now()

    for file_path in files:
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise SystemExit(
                f"Failed to parse allowlist JSON: {file_path} ({exc})"
            ) from exc

        file_rules = payload.get("rules", [])
        if not isinstance(file_rules, list):
            raise SystemExit(
                f"Invalid allowlist format in {file_path}: 'rules' must be a list"
            )

        active_count = 0
        for idx, rule in enumerate(file_rules):
            if not isinstance(rule, dict):
                raise SystemExit(
                    f"Invalid rule at {file_path} index {idx}: expected object"
                )

            rule = dict(rule)
            rule.setdefault("enabled", True)
            rule["_source_file"] = str(file_path)
            rule.setdefault("id", f"{file_path.name}:{idx}")

            if not rule.get("enabled", True):
                continue

            expires_at = _parse_date(rule.get("expires_at"))
            if rule.get("expires_at") and not expires_at:
                # Invalid date formats are treated as expired for safety.
                expired.append(rule)
                continue
            if expires_at and expires_at < now:
                expired.append(rule)
                continue

            rules.append(rule)
            active_count += 1

        load_messages.append(f"{file_path} (active rules: {active_count})")

    return rules, expired, load_messages


def _rule_matches_finding(rule: dict[str, Any], finding: Any, skill_name: str) -> bool:
    if rule.get("skill") and rule.get("skill") != skill_name:
        return False
    if rule.get("rule_id") and rule.get("rule_id") != finding.rule_id:
        return False
    if rule.get("analyzer") and rule.get("analyzer") != finding.analyzer:
        return False
    if (
        rule.get("severity")
        and str(rule.get("severity")).upper() != finding.severity.value
    ):
        return False
    if (
        rule.get("title_contains")
        and str(rule.get("title_contains")).lower() not in finding.title.lower()
    ):
        return False

    rule_file = _normalize_path(rule.get("file_path"))
    finding_file = _normalize_path(getattr(finding, "file_path", None))
    if rule_file:
        if not finding_file:
            return False
        if not (finding_file == rule_file or finding_file.endswith(rule_file)):
            return False

    return True


def apply_allowlist_single(
    scan_result: Any, rules: list[dict[str, Any]]
) -> tuple[Any, list[dict[str, Any]]]:
    suppressed: list[dict[str, Any]] = []
    kept = []
    for finding in scan_result.findings:
        match = next(
            (
                r
                for r in rules
                if _rule_matches_finding(r, finding, scan_result.skill_name)
            ),
            None,
        )
        if match:
            suppressed.append(
                {
                    "skill": scan_result.skill_name,
                    "finding_id": finding.id,
                    "rule_id": finding.rule_id,
                    "severity": finding.severity.value,
                    "title": finding.title,
                    "file_path": finding.file_path,
                    "allowlist_rule_id": match.get("id"),
                    "allowlist_source": match.get("_source_file"),
                    "reason": match.get("reason"),
                    "owner": match.get("owner"),
                    "expires_at": match.get("expires_at"),
                }
            )
        else:
            kept.append(finding)
    scan_result.findings = kept
    return scan_result, suppressed


def apply_allowlist_report(
    report: Any, rules: list[dict[str, Any]]
) -> tuple[Any, list[dict[str, Any]]]:
    suppressed: list[dict[str, Any]] = []

    for scan_result in report.scan_results:
        _, one = apply_allowlist_single(scan_result, rules)
        suppressed.extend(one)

    # Rebuild aggregate counts from filtered scan results.
    rebuilt = type(report)()
    for scan_result in report.scan_results:
        rebuilt.add_scan_result(scan_result)

    return rebuilt, suppressed


def default_output_dir(mode: str) -> Path:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return SCANNER_ROOT / "reports" / "pai-scan" / f"{ts}-{mode}"


def ensure_paths(args: argparse.Namespace) -> tuple[Any, Path]:
    if not SCANNER_ROOT.exists():
        raise SystemExit(f"Scanner root not found: {SCANNER_ROOT}")

    if args.mode == "single":
        if not args.skill_dir:
            raise SystemExit("--skill-dir is required for --mode single")
        if len(args.skill_dir) != 1:
            raise SystemExit("--mode single requires exactly one --skill-dir")
        target = Path(args.skill_dir[0]).resolve()
        if not target.exists() or not (target / "SKILL.md").exists():
            raise SystemExit(f"Invalid skill directory (missing SKILL.md): {target}")
    elif args.mode == "list":
        if not args.skill_list_file and not args.skill_dir:
            raise SystemExit(
                "--mode list requires --skill-list-file and/or one or more --skill-dir"
            )

        collected: list[Path] = []
        if args.skill_list_file:
            list_file = Path(args.skill_list_file).resolve()
            if not list_file.exists():
                raise SystemExit(f"Skill list file not found: {list_file}")
            for raw in list_file.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                collected.append(Path(line).resolve())

        for raw in args.skill_dir or []:
            collected.append(Path(raw).resolve())

        # De-dupe while preserving order.
        target = []
        seen: set[str] = set()
        for skill_dir in collected:
            key = str(skill_dir)
            if key in seen:
                continue
            seen.add(key)
            if not skill_dir.exists() or not (skill_dir / "SKILL.md").exists():
                raise SystemExit(
                    f"Invalid skill directory in list (missing SKILL.md): {skill_dir}"
                )
            target.append(skill_dir)

        if not target:
            raise SystemExit("No valid skill directories provided for --mode list")
    else:
        target = Path(args.skills_dir).resolve()
        if not target.exists():
            raise SystemExit(f"Skills directory not found: {target}")

    out_dir = (
        Path(args.output_dir).resolve()
        if args.output_dir
        else default_output_dir(args.mode)
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    return target, out_dir


def import_scanner_modules() -> tuple:
    # Ensure local fork can be imported even when script lives outside scanner repo.
    if str(SCANNER_ROOT) not in sys.path:
        sys.path.insert(0, str(SCANNER_ROOT))

    try:
        from skill_scanner.cli.cli import generate_multi_skill_summary, generate_summary  # type: ignore[import-not-found]
        from skill_scanner.core.analyzers.behavioral_analyzer import BehavioralAnalyzer  # type: ignore[import-not-found]
        from skill_scanner.core.analyzers.opencode_analyzer import OpencodeAnalyzer  # type: ignore[import-not-found]
        from skill_scanner.core.analyzers.static import StaticAnalyzer  # type: ignore[import-not-found]
        from skill_scanner.core.analyzers.trigger_analyzer import TriggerAnalyzer  # type: ignore[import-not-found]
        from skill_scanner.core.reporters.json_reporter import JSONReporter  # type: ignore[import-not-found]
        from skill_scanner.core.reporters.sarif_reporter import SARIFReporter  # type: ignore[import-not-found]
        from skill_scanner.core.scanner import SkillScanner  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "Failed to import skill_scanner modules. Run via scanner uv env, e.g.\n"
            f"  cd {SCANNER_ROOT}\n"
            "  uv run python /Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py --mode all\n"
            f"Import error: {exc}"
        ) from exc

    return (
        SkillScanner,
        StaticAnalyzer,
        BehavioralAnalyzer,
        OpencodeAnalyzer,
        TriggerAnalyzer,
        JSONReporter,
        SARIFReporter,
        generate_summary,
        generate_multi_skill_summary,
    )


def build_scanner(mods: tuple, args: argparse.Namespace):
    (
        SkillScanner,
        StaticAnalyzer,
        BehavioralAnalyzer,
        OpencodeAnalyzer,
        TriggerAnalyzer,
        _JSONReporter,
        _SARIFReporter,
        _generate_summary,
        _generate_multi_skill_summary,
    ) = mods

    analyzers = [
        StaticAnalyzer(disabled_rules=ADVISORY_DISABLED_RULES),
        BehavioralAnalyzer(use_static_analysis=True),
        TriggerAnalyzer(),
    ]

    if args.use_opencode_analyzer:
        analyzers.append(
            OpencodeAnalyzer(
                model=args.opencode_model,
                agent=args.opencode_agent,
                timeout_seconds=max(30, int(args.opencode_timeout)),
                opencode_binary=args.opencode_binary,
                debug_dir=args.opencode_debug_dir,
            )
        )

    return SkillScanner(analyzers=analyzers)


def run_scan_with_progress(
    scanner: Any,
    target: Any,
    mode: str,
    show_progress: bool,
    progress_interval: int,
    opencode_timeout_hint: int | None = None,
) -> tuple[Any | None, bool]:
    """Run scan with heartbeat/progress visibility."""
    if mode == "single":
        if show_progress:
            print(f"[progress] scanning: {target}", flush=True)
        try:
            result = _scan_one_with_heartbeat(
                scanner=scanner,
                skill_dir=target,
                index=1,
                total=1,
                show_progress=show_progress,
                progress_interval=progress_interval,
            )
            return result, False
        except KeyboardInterrupt:
            if show_progress:
                print(
                    "[progress] interrupted by user during single-skill scan",
                    flush=True,
                )
            return None, True

    # all/list mode: enumerate and scan each skill directory with progress.
    from skill_scanner.core.models import Report  # type: ignore[import-not-found]
    from skill_scanner.core.loader import SkillLoadError  # type: ignore[import-not-found]

    report = Report()
    if mode == "all":
        skill_dirs = scanner._find_skill_directories(target, recursive=True)
    else:
        skill_dirs = [Path(p) for p in target]
    total = len(skill_dirs)

    if show_progress:
        print(f"[progress] discovered {total} skills", flush=True)
        if opencode_timeout_hint:
            est_minutes = (total * max(1, opencode_timeout_hint)) / 60.0
            print(
                "[progress] opencode enabled: "
                f"worst-case serial runtime ≈ {est_minutes:.1f} minutes",
                flush=True,
            )

    interrupted = False
    for idx, skill_dir in enumerate(skill_dirs, start=1):
        try:
            result = _scan_one_with_heartbeat(
                scanner=scanner,
                skill_dir=skill_dir,
                index=idx,
                total=total,
                show_progress=show_progress,
                progress_interval=progress_interval,
            )
            report.add_scan_result(result)
        except KeyboardInterrupt:
            interrupted = True
            if show_progress:
                print(
                    f"[progress] interrupted by user at {idx}/{total}; preserving partial report",
                    flush=True,
                )
            break
        except SkillLoadError as e:
            if show_progress:
                print(f"[{idx}/{total}] skip load error: {skill_dir} ({e})", flush=True)
            continue

    return report, interrupted


def _scan_one_with_heartbeat(
    scanner: Any,
    skill_dir: Path,
    index: int,
    total: int,
    show_progress: bool,
    progress_interval: int,
):
    stop_event = threading.Event()
    start = time.time()

    def heartbeat():
        while not stop_event.wait(max(5, progress_interval)):
            elapsed = int(time.time() - start)
            print(
                f"[{index}/{total}] still scanning {skill_dir.name} ... {elapsed}s elapsed",
                flush=True,
            )

    hb_thread: threading.Thread | None = None
    if show_progress:
        print(f"[{index}/{total}] scanning {skill_dir}", flush=True)
        hb_thread = threading.Thread(target=heartbeat, daemon=True)
        hb_thread.start()

    try:
        result = scanner.scan_skill(skill_dir)
    finally:
        stop_event.set()
        if hb_thread is not None:
            hb_thread.join(timeout=1.0)

    if show_progress:
        elapsed = int(time.time() - start)
        print(
            f"[{index}/{total}] done {result.skill_name} | findings={len(result.findings)} "
            f"max={result.max_severity.value} | {elapsed}s",
            flush=True,
        )

    return result


def write_reports(
    mods: tuple,
    result_or_report,
    out_dir: Path,
    summary_text: str,
    suppressed_findings: list[dict[str, Any]],
    allowlist_sources: list[str],
    expired_allowlist_rules: list[dict[str, Any]],
) -> None:
    (
        _SkillScanner,
        _StaticAnalyzer,
        _BehavioralAnalyzer,
        _OpencodeAnalyzer,
        _TriggerAnalyzer,
        JSONReporter,
        SARIFReporter,
        _generate_summary,
        _generate_multi_skill_summary,
    ) = mods

    summary_path = out_dir / "summary.txt"
    json_path = out_dir / "report.json"
    sarif_path = out_dir / "report.sarif"
    suppressed_path = out_dir / "suppressed-findings.json"
    allowlist_summary_path = out_dir / "allowlist-summary.json"

    summary_path.write_text(summary_text, encoding="utf-8")
    json_path.write_text(
        JSONReporter(pretty=True).generate_report(result_or_report), encoding="utf-8"
    )
    sarif_path.write_text(
        SARIFReporter().generate_report(result_or_report), encoding="utf-8"
    )

    suppressed_path.write_text(
        json.dumps({"suppressed_findings": suppressed_findings}, indent=2),
        encoding="utf-8",
    )
    allowlist_summary_path.write_text(
        json.dumps(
            {
                "allowlist_sources": allowlist_sources,
                "suppressed_count": len(suppressed_findings),
                "expired_rules_count": len(expired_allowlist_rules),
                "expired_rules": expired_allowlist_rules,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print("Artifacts:")
    print(f"  {summary_path}")
    print(f"  {json_path}")
    print(f"  {sarif_path}")
    print(f"  {suppressed_path}")
    print(f"  {allowlist_summary_path}")


def fail_on_findings(mode: str, result_or_report) -> int:
    if mode == "single":
        return 1 if not result_or_report.is_safe else 0
    # report mode
    return (
        1
        if (result_or_report.critical_count > 0 or result_or_report.high_count > 0)
        else 0
    )


def count_findings(mode: str, result_or_report) -> tuple[int, int]:
    """Return (critical_count, high_count)."""
    if mode == "single":
        critical = len(
            [f for f in result_or_report.findings if f.severity.value == "CRITICAL"]
        )
        high = len([f for f in result_or_report.findings if f.severity.value == "HIGH"])
        return critical, high

    return int(result_or_report.critical_count), int(result_or_report.high_count)


def evaluate_gate(profile: str, mode: str, result_or_report) -> tuple[int, str]:
    """Evaluate profile gate and return (exit_code, reason)."""
    critical, high = count_findings(mode, result_or_report)

    if profile == "advisory":
        return 0, f"advisory mode (critical={critical}, high={high})"

    if profile == "block-critical":
        if critical > 0:
            return 3, f"gate block-critical triggered (critical={critical})"
        return 0, f"gate block-critical passed (critical={critical}, high={high})"

    if profile == "block-high":
        if critical > 0 or high > 0:
            return 4, f"gate block-high triggered (critical={critical}, high={high})"
        return 0, f"gate block-high passed (critical={critical}, high={high})"

    return 1, f"unknown gate profile: {profile}"


def main() -> int:
    args = parse_args()
    gate_profile = resolve_gate_profile(args)
    fail_on_expired_allowlist = args.fail_on_expired_allowlist or gate_profile in (
        "block-critical",
        "block-high",
    )

    target, out_dir = ensure_paths(args)
    allowlist_files = resolve_allowlist_files(args)
    allowlist_rules, expired_allowlist_rules, allowlist_load_messages = (
        load_allowlist_rules(allowlist_files)
    )

    if expired_allowlist_rules:
        print(
            f"WARNING: Found {len(expired_allowlist_rules)} expired allowlist rule(s)",
            file=sys.stderr,
        )
        if fail_on_expired_allowlist:
            return 2

    mods = import_scanner_modules()
    scanner = build_scanner(mods, args)

    (
        _SkillScanner,
        _StaticAnalyzer,
        _BehavioralAnalyzer,
        _OpencodeAnalyzer,
        _TriggerAnalyzer,
        _JSONReporter,
        _SARIFReporter,
        generate_summary,
        generate_multi_skill_summary,
    ) = mods

    print(f"Running security scan ({args.mode})", flush=True)
    print(f"  scanner: {SCANNER_ROOT}", flush=True)
    if args.mode == "list":
        print(f"  target:  skill-list ({len(target)} entries)", flush=True)
    else:
        print(f"  target:  {target}", flush=True)
    print(f"  output:  {out_dir}", flush=True)
    print(f"  gate-profile: {gate_profile}", flush=True)
    print(
        f"  disabled-rules (advisory): {json.dumps(sorted(ADVISORY_DISABLED_RULES))}",
        flush=True,
    )
    print(
        f"  progress: {'on' if args.show_progress else 'off'} "
        f"(interval={max(5, int(args.progress_interval))}s)",
        flush=True,
    )
    if args.use_opencode_analyzer:
        print(
            "  opencode-analyzer: "
            f"enabled (model={args.opencode_model}, timeout={max(30, int(args.opencode_timeout))}, "
            f"agent={args.opencode_agent or 'default'})",
            flush=True,
        )
    else:
        print("  opencode-analyzer: disabled", flush=True)
    if allowlist_load_messages:
        print("  allowlist:", flush=True)
        for m in allowlist_load_messages:
            print(f"    - {m}", flush=True)
    else:
        print("  allowlist: none", flush=True)

    if args.mode == "single":
        scan_result, interrupted = run_scan_with_progress(
            scanner=scanner,
            target=target,
            mode="single",
            show_progress=args.show_progress,
            progress_interval=max(5, int(args.progress_interval)),
            opencode_timeout_hint=max(30, int(args.opencode_timeout))
            if args.use_opencode_analyzer
            else None,
        )

        if interrupted and scan_result is None:
            print(
                "Scan interrupted by user. No report was generated.",
                file=sys.stderr,
                flush=True,
            )
            return 130
        suppressed_findings: list[dict[str, Any]] = []
        if allowlist_rules:
            scan_result, suppressed_findings = apply_allowlist_single(
                scan_result, allowlist_rules
            )

        summary = generate_summary(scan_result)
        print(summary)
        write_reports(
            mods,
            scan_result,
            out_dir,
            summary,
            suppressed_findings,
            allowlist_load_messages,
            expired_allowlist_rules,
        )

        gate_code, gate_reason = evaluate_gate(gate_profile, "single", scan_result)
        print(f"Gate: {gate_reason}")
        return gate_code

    report, interrupted = run_scan_with_progress(
        scanner=scanner,
        target=target,
        mode=args.mode,
        show_progress=args.show_progress,
        progress_interval=max(5, int(args.progress_interval)),
        opencode_timeout_hint=max(30, int(args.opencode_timeout))
        if args.use_opencode_analyzer
        else None,
    )
    suppressed_findings = []
    if allowlist_rules:
        report, suppressed_findings = apply_allowlist_report(report, allowlist_rules)

    summary = generate_multi_skill_summary(report)
    print(summary)
    write_reports(
        mods,
        report,
        out_dir,
        summary,
        suppressed_findings,
        allowlist_load_messages,
        expired_allowlist_rules,
    )

    gate_code, gate_reason = evaluate_gate(gate_profile, "all", report)
    print(f"Gate: {gate_reason}")
    if interrupted:
        print(
            "Scan interrupted by user; partial artifacts were written.",
            file=sys.stderr,
            flush=True,
        )
        return 130
    return gate_code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Scan interrupted by user.", file=sys.stderr, flush=True)
        raise SystemExit(130)
