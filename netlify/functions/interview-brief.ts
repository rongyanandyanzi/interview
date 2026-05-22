import {
  buildBriefPrompt,
  extractJsonObject,
  normalizeBrief
} from "../../lib/interview";
import type { InterviewLanguage } from "../../lib/types";

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
    jobDescription?: string;
    language?: InterviewLanguage;
  };

  if (!body.jobDescription?.trim()) {
    return Response.json({ error: "Job description is required." }, { status: 400 });
  }

  const language = body.language === "en" ? "en" : "zh";
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: buildBriefPrompt(body.jobDescription, language)
    })
  });

  if (!response.ok) {
    const details = await response.text();
    return Response.json({ error: readOpenAIError(response.status, details) }, { status: response.status });
  }

  const data = await response.json();
  const brief = normalizeBrief(extractJsonObject(readResponseText(data)));
  return Response.json({ brief });
};

export const config = {
  path: "/api/interview/brief",
  method: ["POST"]
};

function readResponseText(data: unknown) {
  const record = data as { output_text?: string; output?: Array<Record<string, unknown>> };
  if (record.output_text) return record.output_text;

  const parts =
    record.output
      ?.flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .map((content) => {
        const row = content as { text?: string };
        return row.text || "";
      })
      .join("") || "";

  if (!parts.trim()) {
    throw new Error("OpenAI response did not include text output.");
  }

  return parts;
}

function readOpenAIError(status: number, details: string) {
  if (status === 401) {
    return "OpenAI API Key 无效或已被撤销。请在 Netlify 环境变量中换成新的有效 key。";
  }

  if (status === 403) return "当前 OpenAI API Key 没有访问这个模型或接口的权限。";
  if (status === 429) return "OpenAI 请求额度或速率受限，请稍后重试或检查账号额度。";

  try {
    const parsed = JSON.parse(details) as { error?: { message?: string } };
    return parsed.error?.message || "生成面试简报失败，请检查 OpenAI 配置或网络。";
  } catch {
    return "生成面试简报失败，请检查 OpenAI 配置或网络。";
  }
}
