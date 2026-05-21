import type { InterviewFeedback } from "@/lib/types";

export function validateFeedback(feedback: InterviewFeedback) {
  if (!Number.isFinite(feedback.overallScore)) {
    throw new Error("Feedback score must be a number.");
  }

  if (feedback.overallScore < 0 || feedback.overallScore > 100) {
    throw new Error("Feedback score must be between 0 and 100.");
  }

  if (!Array.isArray(feedback.strengths) || !Array.isArray(feedback.risks)) {
    throw new Error("Feedback strengths and risks must be arrays.");
  }

  if (!Array.isArray(feedback.questionFeedback)) {
    throw new Error("Question feedback must be an array.");
  }

  for (const item of feedback.questionFeedback) {
    if (
      typeof item.question !== "string" ||
      typeof item.assessment !== "string" ||
      typeof item.suggestion !== "string"
    ) {
      throw new Error("Question feedback entries are malformed.");
    }
  }

  return true;
}
