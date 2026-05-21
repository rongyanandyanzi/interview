import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  normalizeFeedback,
  summarizeJobDescription
} from "@/lib/interview";
import { HISTORY_KEY, loadHistory, saveHistoryItem } from "@/lib/storage";
import { validateFeedback } from "@/lib/validation";
import type { InterviewFeedback, InterviewHistoryItem } from "@/lib/types";

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    }
  };
}

describe("job description helpers", () => {
  it("summarizes long job descriptions", () => {
    const summary = summarizeJobDescription("a".repeat(180));
    expect(summary).toHaveLength(143);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("extracts JSON from model text", () => {
    expect(extractJsonObject("Here is the result:\n{\"score\":88}")).toEqual({ score: 88 });
  });
});

describe("history storage", () => {
  it("saves newest interview first", () => {
    const storage = createStorage();
    const item = makeHistoryItem("one");
    const nextItem = makeHistoryItem("two");

    saveHistoryItem(storage, item);
    saveHistoryItem(storage, nextItem);

    const history = loadHistory(storage);
    expect(history.map((row) => row.id)).toEqual(["two", "one"]);
    expect(storage.getItem(HISTORY_KEY)).toContain("Target role");
  });

  it("returns an empty history for malformed storage", () => {
    const storage = createStorage();
    storage.setItem(HISTORY_KEY, "not-json");
    expect(loadHistory(storage)).toEqual([]);
  });
});

describe("feedback validation", () => {
  it("accepts normalized feedback", () => {
    const feedback = normalizeFeedback({
      overallScore: 91,
      summary: "Strong role fit.",
      strengths: ["Clear examples"],
      risks: ["Needs sharper metrics"],
      questionFeedback: [
        {
          question: "Tell me about a project.",
          assessment: "Relevant and concise.",
          suggestion: "Add business impact."
        }
      ],
      nextPractice: ["Practice metrics."]
    });

    expect(validateFeedback(feedback)).toBe(true);
    expect(feedback.overallScore).toBe(91);
  });

  it("rejects invalid scores", () => {
    const feedback: InterviewFeedback = {
      overallScore: Number.NaN,
      summary: "",
      strengths: [],
      risks: [],
      questionFeedback: [],
      nextPractice: []
    };

    expect(() => validateFeedback(feedback)).toThrow("Feedback score must be a number.");
  });
});

function makeHistoryItem(id: string): InterviewHistoryItem {
  return {
    id,
    createdAt: new Date("2026-05-18T00:00:00.000Z").toISOString(),
    language: "zh",
    jdSummary: "Summary",
    brief: {
      roleTitle: "Target role",
      seniority: "Senior",
      focusAreas: ["Systems"],
      openingQuestion: "Opening?",
      interviewPlan: ["Plan"]
    },
    transcript: [],
    feedback: {
      overallScore: 80,
      summary: "Good",
      strengths: [],
      risks: [],
      questionFeedback: [],
      nextPractice: []
    }
  };
}
