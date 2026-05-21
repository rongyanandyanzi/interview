import type {
  InterviewBrief,
  InterviewFeedback,
  InterviewLanguage,
  TranscriptEntry
} from "@/lib/types";
import { validateFeedback } from "@/lib/validation";

const LANGUAGE_LABEL: Record<InterviewLanguage, string> = {
  zh: "中文",
  en: "English"
};

export function languageLabel(language: InterviewLanguage) {
  return LANGUAGE_LABEL[language];
}

export function summarizeJobDescription(jobDescription: string) {
  const normalized = jobDescription.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

export function buildBriefPrompt(jobDescription: string, language: InterviewLanguage) {
  return [
    `You are designing a realistic mock interview in ${languageLabel(language)}.`,
    "Read the job description and return only valid JSON.",
    "The JSON shape must be:",
    "{ roleTitle: string, seniority: string, focusAreas: string[], openingQuestion: string, interviewPlan: string[] }",
    "Use 4-6 focus areas and 5-7 plan items. Keep questions practical and role-specific.",
    `Job description:\n${jobDescription}`
  ].join("\n\n");
}

export function buildFeedbackPrompt(
  jobDescription: string,
  language: InterviewLanguage,
  transcript: TranscriptEntry[]
) {
  const transcriptText = transcript
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
    .join("\n");

  return [
    `You are an interview coach writing feedback in ${languageLabel(language)}.`,
    "Return only valid JSON with this exact shape:",
    "{ overallScore: number, summary: string, strengths: string[], risks: string[], questionFeedback: { question: string, assessment: string, suggestion: string }[], nextPractice: string[] }",
    "overallScore must be 0-100. Give direct, practical feedback grounded in the transcript.",
    `Job description:\n${jobDescription}`,
    `Transcript:\n${transcriptText || "No transcript captured."}`
  ].join("\n\n");
}

export function buildRealtimeInstructions(
  jobDescription: string,
  language: InterviewLanguage,
  brief?: InterviewBrief
) {
  const openingQuestion = brief?.openingQuestion
    ? `Open with this question: ${brief.openingQuestion}`
    : "Open with a concise role-specific question.";

  return [
    `You are a professional AI interviewer. Conduct the interview in ${languageLabel(language)} only.`,
    "Disclose naturally at the beginning that the voice is AI-generated.",
    "Ask one question at a time. Listen to the candidate's answer, then ask a targeted follow-up before moving on when useful.",
    "Do not give away ideal answers during the interview. Keep responses short and conversational.",
    "Evaluate job-relevant examples, depth, clarity, tradeoff thinking, and communication.",
    "If the candidate is silent or unclear, politely ask them to clarify.",
    "When the candidate asks to finish, give a brief closing and stop asking new questions.",
    openingQuestion,
    brief?.focusAreas?.length ? `Focus areas: ${brief.focusAreas.join(", ")}` : "",
    `Job description:\n${jobDescription}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("The model did not return a JSON object.");
  }
  return JSON.parse(match[0]);
}

export function normalizeBrief(value: unknown): InterviewBrief {
  const data = value as Partial<InterviewBrief>;
  return {
    roleTitle: String(data.roleTitle || "Target role"),
    seniority: String(data.seniority || "Not specified"),
    focusAreas: Array.isArray(data.focusAreas)
      ? data.focusAreas.map(String).filter(Boolean).slice(0, 8)
      : [],
    openingQuestion: String(data.openingQuestion || "Could you walk me through your relevant experience for this role?"),
    interviewPlan: Array.isArray(data.interviewPlan)
      ? data.interviewPlan.map(String).filter(Boolean).slice(0, 10)
      : []
  };
}

export function normalizeFeedback(value: unknown): InterviewFeedback {
  const data = value as Partial<InterviewFeedback>;
  const feedback: InterviewFeedback = {
    overallScore: Number.isFinite(Number(data.overallScore))
      ? Math.max(0, Math.min(100, Number(data.overallScore)))
      : 0,
    summary: String(data.summary || ""),
    strengths: Array.isArray(data.strengths) ? data.strengths.map(String).filter(Boolean) : [],
    risks: Array.isArray(data.risks) ? data.risks.map(String).filter(Boolean) : [],
    questionFeedback: Array.isArray(data.questionFeedback)
      ? data.questionFeedback
          .map((item) => {
            const row = item as Record<string, unknown>;
            return {
              question: String(row.question || ""),
              assessment: String(row.assessment || ""),
              suggestion: String(row.suggestion || "")
            };
          })
          .filter((item) => item.question || item.assessment || item.suggestion)
      : [],
    nextPractice: Array.isArray(data.nextPractice)
      ? data.nextPractice.map(String).filter(Boolean)
      : []
  };

  validateFeedback(feedback);
  return feedback;
}
