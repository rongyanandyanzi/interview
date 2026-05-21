import { NextResponse } from "next/server";
import { buildRealtimeInstructions } from "@/lib/interview";
import type { InterviewBrief, InterviewLanguage } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    sdp?: string;
    jobDescription?: string;
    language?: InterviewLanguage;
    brief?: InterviewBrief;
  };

  if (!body.sdp?.trim()) {
    return NextResponse.json({ error: "SDP offer is required." }, { status: 400 });
  }

  if (!body.jobDescription?.trim()) {
    return NextResponse.json({ error: "Job description is required." }, { status: 400 });
  }

  const language = body.language === "en" ? "en" : "zh";
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";

  const formData = new FormData();
  formData.set("sdp", body.sdp);
  formData.set(
    "session",
    JSON.stringify({
      type: "realtime",
      model,
      instructions: buildRealtimeInstructions(body.jobDescription, language, body.brief),
      audio: {
        input: {
          transcription: {
            model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"
          }
        },
        output: { voice }
      }
    })
  );

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  const answer = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      { error: "Failed to create realtime interview session.", details: answer },
      { status: response.status }
    );
  }

  return new Response(answer, {
    status: 200,
    headers: {
      "Content-Type": "application/sdp"
    }
  });
}
