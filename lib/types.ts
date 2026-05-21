export type InterviewLanguage = "zh" | "en";

export type InterviewPhase = "setup" | "brief" | "live" | "review";

export type InterviewBrief = {
  roleTitle: string;
  seniority: string;
  focusAreas: string[];
  openingQuestion: string;
  interviewPlan: string[];
};

export type TranscriptEntry = {
  id: string;
  role: "interviewer" | "candidate" | "system";
  text: string;
  at: string;
};

export type QuestionFeedback = {
  question: string;
  assessment: string;
  suggestion: string;
};

export type InterviewFeedback = {
  overallScore: number;
  summary: string;
  strengths: string[];
  risks: string[];
  questionFeedback: QuestionFeedback[];
  nextPractice: string[];
};

export type InterviewHistoryItem = {
  id: string;
  createdAt: string;
  language: InterviewLanguage;
  jdSummary: string;
  brief: InterviewBrief;
  transcript: TranscriptEntry[];
  feedback: InterviewFeedback;
};
