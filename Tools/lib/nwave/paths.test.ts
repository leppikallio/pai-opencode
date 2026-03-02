import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { guessNwaveRoot, looksLikeNwaveRoot } from "./paths";

function makeFakeNwaveRoot(parentDir: string): string {
  const root = path.join(parentDir, "nWave");
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks", "nw"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "templates"), { recursive: true });
  return root;
}

describe("looksLikeNwaveRoot", () => {
  test("returns true when required directories exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nwave-root-"));
    const root = makeFakeNwaveRoot(tmp);
    expect(looksLikeNwaveRoot(root)).toBe(true);
  });

  test("returns false when directories are missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nwave-root-"));
    const root = path.join(tmp, "nWave");
    fs.mkdirSync(root, { recursive: true });
    expect(looksLikeNwaveRoot(root)).toBe(false);
  });
});

describe("guessNwaveRoot", () => {
  test("prefers NWAVE_ROOT env var when valid", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nwave-root-"));
    const envRoot = makeFakeNwaveRoot(tmp);

    const guessed = guessNwaveRoot({
      cwd: "/",
      env: { NWAVE_ROOT: envRoot },
    });

    expect(guessed).toBe(path.resolve(envRoot));
  });

  test("uses NWAVE_REPO_ROOT/nWave when valid", () => {
    const repoTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nwave-repo-"));
    const nwaveRoot = makeFakeNwaveRoot(repoTmp);

    const guessed = guessNwaveRoot({
      cwd: "/",
      env: { NWAVE_REPO_ROOT: repoTmp },
    });

    expect(guessed).toBe(path.resolve(nwaveRoot));
  });
});
