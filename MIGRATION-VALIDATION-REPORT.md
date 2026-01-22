# Migration Validation Report

**Generated**: 2026-01-22T01:05:36.680Z
**Manifest**: .opencode/MIGRATION-MANIFEST.json
**Model**: opencode/grok-code

## Summary

- **Total Checks**: 15
- **Passed**: 8
- **Failed**: 7
- **Critical Failures**: 2
- **Overall Status**: ❌ FAILED

## Phase A: Deterministic Checks

**Results**: 8/12 passed (2 critical failures)

- ✅ **STRUCT-001** plugins_directory_exists
- ✅ **STRUCT-002** no_hooks_directory
- ✅ **STRUCT-003** pai_unified_exists
- ✅ **STRUCT-004** pai_unified_loadable
- ❌ **STRUCT-005** config_valid
  Config invalid: Error: ENOENT: no such file or directory, open '.opencode/config.json'
- ✅ **STRUCT-006** skills_directory_exists
- ✅ **STRUCT-007** core_skill_exists
- ❌ **CONTENT-001** no_hooks_references
  Found 10 violation(s)
- ✅ **CONTENT-002** no_claude_references
- ✅ **CONTENT-003** no_legacy_mcp_servers
- ❌ **MANIFEST-001** manifest_valid
  Cannot read manifest: Error: Manifest not found at undefined
- ❌ **MANIFEST-002** all_transformations_done
  Cannot check transformations: Error: Manifest not found at undefined

## Phase B: LLM-Assisted Checks

**Results**: 0/0 passed



## Phase C: Self-Test

**Results**: 0/3 passed

- ❌ **SELF-001** can_load_core_skill
  CORE skill missing sections: Stack Preferences
- ❌ **SELF-002** can_parse_config
  Cannot parse config: Error: ENOENT: no such file or directory, open '.opencode/config.json'
- ❌ **SELF-003** plugin_exports_correct_interface
  Plugin missing onSessionStart export

## Conclusion

❌ Migration validation failed. Please review the failures above and re-run validation.

Critical failures must be resolved before the migration can be considered complete.
