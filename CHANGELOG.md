# Changelog

All notable changes to PAI-OpenCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-01-01

### Added
- Skills Translation: Migrated PAI 2.0 skills to OpenCode native format
- OpenCode lazy loading support for 3-tier progressive disclosure
- CORE skill migrated to `.opencode/skill/CORE/`
- CreateSkill migrated to `.opencode/skill/CreateSkill/`
- skill-migrate.ts tool for automated skill migration
- Token reduction validation (≥90% achieved via progressive disclosure)

### Changed
- Skills path from `.claude/skills/` to `.opencode/skill/` (OpenCode native)
- Adopted OpenCode native lazy loading mechanism

### Fixed
- Corrected OpenCode directory naming: `.opencode/skill/` (singular, not plural)
- Removed `.opencode/tool/` directory (OpenCode auto-loads files from this path)
- Moved `skill-migrate.ts` to `tools/` outside `.opencode/` to prevent auto-execution

### Learned
- OpenCode enforces singular naming: `.opencode/skill/` not `.opencode/skills/`
- Files in `.opencode/tool/` are auto-loaded by OpenCode - use for native tools only
- PAI 2.0 and OpenCode SKILL.md formats are 100% identical (no translation needed)

### Documentation
- Added SKILLS-MIGRATION.md guide
- Documented format compatibility (SKILL.md format unchanged)
- Added token reduction report (90%+ reduction validated)

## [0.2.0] - 2026-01-01

### Added
- Vanilla OpenCode installation and configuration
- kai-core-install pack installation
- Git repository initialization
- Basic workspace structure (.opencode/, docs/, vendor/)
- Constitution v3.6.0
- ROADMAP v3.1.0

### Infrastructure
- Established OpenCode workspace at ~/Workspace/github.com/Steffen025/pai-opencode
- Git repository with main branch
- Public repository preparation for Phase 1 (community contributions)

## [0.1.0] - 2026-01-01

### Added
- Initial project conception
- Project plan and research phase
- PAI-OpenCode project structure
- Constitution v3.0.0 draft
- ROADMAP v3.0.0 draft
