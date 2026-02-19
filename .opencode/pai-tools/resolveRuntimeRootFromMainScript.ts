import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve runtime root from the main CLI script location.
 *
 * Expected layout:
 *   <runtime-root>/pai-tools/<script>.ts
 *
 * The returned runtime root is the parent directory of the nearest
 * `pai-tools/` directory that contains the script.
 */
export function resolveRuntimeRootFromMainScript(mainMetaUrl: string): string {
  const mainScriptPath = path.resolve(fileURLToPath(mainMetaUrl));

  let cursor = path.resolve(path.dirname(mainScriptPath));
  while (true) {
    if (path.basename(cursor) === "pai-tools") {
      return path.resolve(cursor, "..");
    }

    const parent = path.resolve(cursor, "..");
    if (parent === cursor) {
      return path.resolve(path.dirname(mainScriptPath), "..");
    }

    cursor = parent;
  }
}
