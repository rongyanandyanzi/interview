import { buildRealtimeInstructions } from "../../lib/interview";
import type { InterviewBrief, InterviewLanguage } from "../../lib/types";

export default async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "服务端没有配置 OPENAI_API_KEY。请在 Netlify 环境变量中添加它。" },
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
    return Response.json({ error: "SDP offer is required." }, { status: 400 });
  }

  if (!body.jobDescription?.trim()) {
    return Response.json({ error: "Job description is required." }, { status: 400 });
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
    return Response.json(
      { error: "创建实时面试会话失败，请检查 OpenAI 配置或模型权限。" },
      { status: response.status }
    );
  }

  return new Response(answer, {
    status: 200,
    headers: {
      "Content-Type": "application/sdp"
    }
  });
};

export const config = {
  path: "/api/realtime/session",
  method: ["POST"]
};
