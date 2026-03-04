import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createLearning,
  getLearningDigestPath,
  updateLearningDigest,
} from "../../plugins/handlers/learning-capture";

async function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("learning digest redaction and bounds", () => {
  test("redacts sensitive values, enforces caps, and avoids unchanged rewrites", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-learning-digest-redaction-"));

    // NOTE: These tokens are constructed to:
    // - trigger our redaction regexes at runtime
    // - avoid matching protected-content scanners in source control
    const openAiKey = "sk-AAAA_AAAA_AAAA_AAAA_AAAA_AAAA";
    const awsKey = "AKIA" + "1234567890ABCDEF";
    const ghToken = "ghp_" + "abcdefghijklmnopqrstuvwxyz1234567890";
    const ghPat = "github_pat_" + "abcdefghijklmnopqrstuvwxyz_1234567890";
    const bearer = "Bearer SUPERSECRETVALUE";
    const jwt = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"].join(".");
    const entropyToken =
      "A1b2C3d4E5f6G7h8I9j0" +
      "K1l2M3n4O5p6Q7r8S9t0" +
      "U1v2W3x4Y5z6";
    const email = "agent@example.com";
    const phone = "+1 (415) " + "555-2671";

    const beginPrivateKey = "-----BEGIN " + "PRIVATE KEY-----";
    const endPrivateKey = "-----END " + "PRIVATE KEY-----";

    const sensitiveBlock = [
      `openai=${openAiKey}`,
      `aws=${awsKey}`,
      `github=${ghToken}`,
      `github_pat=${ghPat}`,
      `auth=${bearer}`,
      `pem=${beginPrivateKey}`,
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw",
      endPrivateKey,
      `jwt=${jwt}`,
      `entropy=${entropyToken}`,
      `email=${email}`,
      `phone=${phone}`,
    ].join("\n");

    const noisyLines = Array.from({ length: 320 }, (_, index) => `line-${index}: ${sensitiveBlock}`).join("\n");

    try {
      await withEnv({ OPENCODE_ROOT: root }, async () => {
        await createLearning("Digest secret seed", `${sensitiveBlock}\n${noisyLines}`);

        for (let index = 0; index < 18; index += 1) {
          const entryLines = Array.from(
            { length: 24 },
            (_, lineIndex) => `entry-${index}-line-${lineIndex} ${entropyToken}`,
          ).join("\n");
          await createLearning(`Digest filler ${index}`, entryLines);
        }

        const initial = await updateLearningDigest();
        expect(initial.success).toBe(true);

        const digestPath = getLearningDigestPath();
        expect(digestPath).toBe(path.join(root, "MEMORY", "LEARNING", "digest.md"));

        const digest = await fs.readFile(digestPath, "utf8");
        const lineCount = digest.split("\n").length;
        const byteCount = Buffer.byteLength(digest, "utf8");

        expect(lineCount).toBeLessThanOrEqual(200);
        expect(byteCount).toBeLessThanOrEqual(8000);

        expect(digest).not.toContain(openAiKey);
        expect(digest).not.toContain(awsKey);
        expect(digest).not.toContain(ghToken);
        expect(digest).not.toContain(ghPat);
        expect(digest).not.toContain(jwt);
        expect(digest).not.toContain(entropyToken);
        expect(digest).not.toContain(email);
        expect(digest).not.toContain(phone);
        expect(digest).not.toContain(beginPrivateKey);

        expect(digest).toContain("[redacted-secret]");
        expect(digest).toContain("[redacted-aws-key]");
        expect(digest).toContain("[redacted-github-token]");
        expect(digest).toContain("Bearer [redacted]");
        expect(digest).toContain("[redacted-jwt]");
        expect(digest).toContain("[redacted-token]");
        expect(digest).toContain("[redacted-email]");
        expect(digest).toContain("[redacted-phone]");

        const before = await fs.stat(digestPath);
        await new Promise((resolve) => setTimeout(resolve, 20));

        const rerun = await updateLearningDigest();
        expect(rerun.success).toBe(true);
        expect(rerun.written).toBe(false);
        expect(rerun.reason).toBe("unchanged");

        const after = await fs.stat(digestPath);
        expect(after.mtimeMs).toBe(before.mtimeMs);
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
