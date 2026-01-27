#!/usr/bin/env bun
// @ts-nocheck
/*
Replace curl-based voice notifications in markdown with voice_notify tool instructions.

Scope:
- Rewrites fenced ```bash code blocks that post to http://localhost:8888/notify
- Rewrites inline `curl ... http://localhost:8888/notify ...` snippets

Non-goals:
- Do not remove documentation that merely mentions the notify URL without curl.
*/

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type ReplaceResult = {
  file: string;
  changed: boolean;
  replacements: number;
};

function extractMessage(input: string): string | null {
  // Handles JSON-ish bodies like:
  // -d '{"message":"..."}'
  // -d '{"message": "...", "voice_id": "..."}'
  // -d '{"message": "..."}'
  const m = input.match(/["']message["']\s*:\s*["']([^"']+)["']/);
  return m?.[1]?.trim() || null;
}

function voiceNotifySnippet(message: string | null): string {
  const msg = message && message.length ? message : "Your message here";
  return [
    "Use the `voice_notify` tool:",
    "",
    `- \`message\`: \"${msg.split('"').join('\\"')}\"`,
  ].join("\n");
}

function replaceBashFences(content: string): { next: string; count: number } {
  let count = 0;
  const next = content.replace(/```bash\n([\s\S]*?)\n```/g, (full, body) => {
    const txt = String(body);
    if (!txt.includes("http://localhost:8888/notify")) return full;
    if (!txt.includes("curl")) return full;

    count++;
    const message = extractMessage(txt);
    return voiceNotifySnippet(message);
  });
  return { next, count };
}

function replaceInlineCurl(content: string): { next: string; count: number } {
  let count = 0;
  const next = content.replace(/`([^`]*?curl[^`]*?http:\/\/localhost:8888\/notify[^`]*)`/g, (full, inner) => {
    const txt = String(inner);
    const message = extractMessage(txt);
    count++;
    const msg = message && message.length ? message : "...";
    return `\`voice_notify\` (message: \"${msg.split('"').join('\\"')}\")`;
  });
  return { next, count };
}

async function run(root: string): Promise<ReplaceResult[]> {
  const glob = new Bun.Glob("**/*.md");
  const results: ReplaceResult[] = [];

  for await (const rel of glob.scan({ cwd: root, dot: true })) {
    const file = path.join(root, rel);
    const original = readFileSync(file, "utf-8");

    let updated = original;
    let replaced = 0;

    const fences = replaceBashFences(updated);
    updated = fences.next;
    replaced += fences.count;

    const inline = replaceInlineCurl(updated);
    updated = inline.next;
    replaced += inline.count;

    const changed = updated !== original;
    if (changed) writeFileSync(file, updated, "utf-8");

    results.push({ file, changed, replacements: replaced });
  }

  return results;
}

const skillsDir = path.join(process.cwd(), ".opencode", "skills");
const results = await run(skillsDir);

const changed = results.filter((r) => r.changed);
const totalReplacements = changed.reduce((sum, r) => sum + r.replacements, 0);

console.log(`Processed ${results.length} markdown files under ${skillsDir}`);
console.log(`Changed ${changed.length} files; replaced ${totalReplacements} curl snippet(s)`);
for (const r of changed) {
  console.log(`- ${path.relative(process.cwd(), r.file)}: ${r.replacements}`);
}
