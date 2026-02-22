#!/usr/bin/env bun
import { runHook } from "./lib/hook-stub";

await runHook({ hookName: "QuestionAnswered.hook.ts" });
