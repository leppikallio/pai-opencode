/**
 * Security validator compatibility facade.
 *
 * Canonical implementation now lives in ../security/index.ts.
 */

import { resetSecurityPolicyCache as resetSecurityPolicyCacheForTestCompat } from "../security";

export {
  createSecurityValidator,
  extractApplyPatchPaths,
  resetSecurityPolicyCache,
  resolveApplyPatchPaths,
  validateSecurity,
} from "../security";

/**
 * @deprecated Prefer createSecurityValidator() and per-instance loaders in tests.
 */
export function __resetSecurityConfigCacheForTests(): void {
  if (process.env.NODE_ENV !== "test" && process.env.BUN_TEST !== "1") {
    return;
  }

  resetSecurityPolicyCacheForTestCompat();
}
