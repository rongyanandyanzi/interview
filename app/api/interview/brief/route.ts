import { NextResponse } from "next/server";
import {
  buildBriefPrompt,
  extractJsonObject,
  normalizeBrief
} from "@/lib/interview";
import type { InterviewLanguage } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端没有配置 OPENAI_API_KEY。请创建 .env.local 后重启 dev server。" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    jobDescription?: string;
    language?: InterviewLanguage;
  };

  if (!body.jobDescription?.trim()) {
    return NextResponse.json({ error: "Job description is required." }, { status: 400 });
  }

  const language = body.language === "en" ? "en" : "zh";
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: buildBriefPrompt(body.jobDescription, language)
      })
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: readOpenAIError(response.status, details) },
        { status: response.status }
      );
    }

    const data = await response.json();
    const text = readResponseText(data);
    const brief = normalizeBrief(extractJsonObject(text));

    return NextResponse.json({ brief });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof DOMException && error.name === "AbortError"
            ? "准备面试超时，请稍后重试。"
            : "准备面试失败，请检查服务端日志。"
      },
      { status: 504 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readOpenAIError(status: number, details: string) {
  if (status === 401) {
    return "OpenAI API Key 无效或已被撤销。请在 .env.local 中换成新的有效 key，然后重启 dev server。";
  }

  if (status === 403) {
    return "当前 OpenAI API Key 没有访问这个模型或接口的权限。";
  }

  if (status === 429) {
    return "OpenAI 请求额度或速率受限，请稍后重试或检查账号额度。";
  }

  try {
    const parsed = JSON.parse(details) as { error?: { message?: string } };
    return parsed.error?.message || "准备面试失败，请检查 OpenAI 配置或网络。";
  } catch {
    return "准备面试失败，请检查 OpenAI 配置或网络。";
  }
}

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
