import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildLearningContext } from "../../skills/utilities/pai-upgrade/Tools/BuildLearningContext";
import {
  appendRecommendationFeedback,
  buildRecommendationFeedbackEntry,
  rankRecommendations,
  readRecommendationHistory,
} from "../../skills/utilities/pai-upgrade/Tools/RankRecommendations";

describe("pai-upgrade recommendation feedback contracts", () => {
  test("feedback is appended to the expected recommendation ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-feedback-ledger-"));

    try {
      const historyPath = path.join(root, "runtime", "history", "recommendation-history.jsonl");
      const feedback = buildRecommendationFeedbackEntry({
        recommendation_id: "openai-blog:blog:rank-1",
        source_id: "openai-blog",
        category: "blog",
        tags: ["openai", "monitor"],
        decision: "accepted",
        helpfulness: "helpful",
        confidence: 0.95,
        notes: "Great signal quality",
        run_id: "run-feedback-contract",
        timestamp: "2026-03-08T11:00:00.000Z",
      });

      appendRecommendationFeedback(feedback, historyPath);

      expect(existsSync(historyPath)).toBe(true);

      const records = readRecommendationHistory(historyPath);
      expect(records.length).toBe(2);

      const feedbackRecord = records.find((entry) => entry.type === "feedback");
      expect(feedbackRecord).toBeDefined();
      if (feedbackRecord && feedbackRecord.type === "feedback") {
        expect(feedbackRecord.recommendation_id).toBe("openai-blog:blog:rank-1");
        expect(feedbackRecord.source_id).toBe("openai-blog");
        expect(feedbackRecord.decision).toBe("accepted");
        expect(feedbackRecord.helpfulness).toBe("helpful");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ranking consumes feedback to raise and lower candidate scores", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-feedback-ranking-"));

    try {
      const learningRoot = path.join(root, "memory", "LEARNING");
      const ratingsPath = path.join(learningRoot, "SIGNALS", "ratings.jsonl");
      const failuresRoot = path.join(learningRoot, "FAILURES");
      const historyPath = path.join(root, "runtime", "history", "recommendation-history.jsonl");

      await mkdir(path.dirname(ratingsPath), { recursive: true });
      await mkdir(failuresRoot, { recursive: true });
      await writeFile(
        ratingsPath,
        `${JSON.stringify({
          timestamp: "2026-03-08T09:00:00.000Z",
          rating: 7,
          source: "explicit",
          sentiment_summary: "Monitor behavior is mostly stable",
        })}\n`,
        "utf-8",
      );

      const learningContext = buildLearningContext({
        memoryRoot: path.join(root, "memory"),
        learningRoot,
        ratingsPath,
        failuresRoot,
        now: () => new Date("2026-03-08T11:30:00.000Z"),
      });

      const candidateUp = {
        id: "candidate-up",
        title: "Provider monitor for OpenAI docs",
        priority: "medium" as const,
        tags: ["openai", "monitor"],
        category: "docs",
        source_id: "openai-docs",
      };

      const candidateDown = {
        id: "candidate-down",
        title: "Experimental migration rewrite",
        priority: "medium" as const,
        tags: ["ecosystem", "migration"],
        category: "github",
        source_id: "ecosystem-github",
      };

      const positiveFeedback = [1, 2, 3].map((index) => buildRecommendationFeedbackEntry({
        recommendation_id: "candidate-up",
        source_id: "openai-docs",
        category: "docs",
        tags: ["openai", "monitor"],
        decision: "accepted",
        helpfulness: "helpful",
        confidence: 1,
        timestamp: `2026-03-08T11:0${index}:00.000Z`,
      }));

      const negativeFeedback = [1, 2, 3].map((index) => buildRecommendationFeedbackEntry({
        recommendation_id: "candidate-down",
        source_id: "ecosystem-github",
        category: "github",
        tags: ["ecosystem", "migration"],
        decision: "ignored",
        helpfulness: "harmful",
        confidence: 1,
        timestamp: `2026-03-08T11:1${index}:00.000Z`,
      }));

      appendRecommendationFeedback([...positiveFeedback, ...negativeFeedback], historyPath);

      const withoutFeedback = rankRecommendations([candidateUp, candidateDown], learningContext, {
        historyPath,
        persistHistory: false,
        applyFeedback: false,
      });

      const withFeedback = rankRecommendations([candidateUp, candidateDown], learningContext, {
        historyPath,
        persistHistory: false,
        applyFeedback: true,
      });

      const upNoFeedback = withoutFeedback.find((entry) => entry.id === "candidate-up");
      const downNoFeedback = withoutFeedback.find((entry) => entry.id === "candidate-down");
      const upWithFeedback = withFeedback.find((entry) => entry.id === "candidate-up");
      const downWithFeedback = withFeedback.find((entry) => entry.id === "candidate-down");

      expect(upNoFeedback).toBeDefined();
      expect(downNoFeedback).toBeDefined();
      expect(upWithFeedback).toBeDefined();
      expect(downWithFeedback).toBeDefined();

      if (upNoFeedback && downNoFeedback && upWithFeedback && downWithFeedback) {
        expect(upWithFeedback.adjusted_score).toBeGreaterThan(upNoFeedback.adjusted_score);
        expect(downWithFeedback.adjusted_score).toBeLessThan(downNoFeedback.adjusted_score);
        expect(upWithFeedback.feedback_matches).toBeGreaterThan(0);
        expect(downWithFeedback.feedback_matches).toBeGreaterThan(0);
      }

      expect(withFeedback[0]?.id).toBe("candidate-up");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
