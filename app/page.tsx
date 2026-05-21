"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { extractTextFromFile } from "@/lib/fileText";
import {
  languageLabel,
  summarizeJobDescription
} from "@/lib/interview";
import { loadHistory, saveHistoryItem } from "@/lib/storage";
import type {
  InterviewBrief,
  InterviewFeedback,
  InterviewHistoryItem,
  InterviewLanguage,
  InterviewPhase,
  TranscriptEntry
} from "@/lib/types";

const emptyFeedback: InterviewFeedback = {
  overallScore: 0,
  summary: "",
  strengths: [],
  risks: [],
  questionFeedback: [],
  nextPractice: []
};

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [language, setLanguage] = useState<InterviewLanguage>("zh");
  const [phase, setPhase] = useState<InterviewPhase>("setup");
  const [brief, setBrief] = useState<InterviewBrief | null>(null);
  const [feedback, setFeedback] = useState<InterviewFeedback>(emptyFeedback);
  const [history, setHistory] = useState<InterviewHistoryItem[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState("等待岗位描述");
  const [error, setError] = useState("");
  const [isLoadingBrief, setIsLoadingBrief] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  const assistantDraftRef = useRef("");

  const trimmedJobDescription = jobDescription.trim();
  const canPrepare = trimmedJobDescription.length >= 10 && !isLoadingBrief;
  const prepareHint =
    trimmedJobDescription.length < 10
      ? "请先粘贴或上传可读取的岗位描述，至少 10 个字符。"
      : "点击后通常需要 5-15 秒准备语音面试。";
  const jdSummary = useMemo(() => summarizeJobDescription(jobDescription), [jobDescription]);

  useEffect(() => {
    setHistory(loadHistory(window.localStorage));
    return () => stopRealtime();
  }, []);

  async function handleFileUpload(file: File | null) {
    if (!file) return;

    setError("");
    setStatus("正在读取文件");
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) {
        throw new Error("没有从文件中读取到文本，请改为手动粘贴岗位描述。");
      }
      setJobDescription(text);
      setStatus("岗位描述已读取");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件读取失败，请手动粘贴岗位描述。");
      setStatus("文件读取失败");
    }
  }

  async function generateBrief() {
    setIsLoadingBrief(true);
    setError("");
    setStatus("AI 正在准备面试");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch("/api/interview/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, language }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "准备面试失败");

      setBrief(data.brief);
      setFeedback(emptyFeedback);
      setTranscript([]);
      setPhase("brief");
      setStatus("面试已准备好");
    } catch (briefError) {
      setError(readUiError(briefError, "准备面试超时或失败，请检查 OPENAI_API_KEY 后重试。"));
      setStatus("准备失败");
    } finally {
      window.clearTimeout(timeout);
      setIsLoadingBrief(false);
    }
  }

  async function startInterview() {
    if (!brief) return;

    setIsConnecting(true);
    setError("");
    setStatus("正在请求麦克风权限");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      localStreamRef.current = stream;
      startMicMeter(stream);

      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioElementRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dataChannel = pc.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.addEventListener("open", () => {
        setStatus("面试进行中");
        sendRealtimeEvent({
          type: "response.create",
          response: {
            instructions:
              language === "zh"
                ? "请现在开始模拟面试，先说明这是 AI 生成语音，然后提出开场问题。"
                : "Start the mock interview now. First disclose that this is an AI-generated voice, then ask the opening question."
          }
        });
      });
      dataChannel.addEventListener("message", (event) => handleRealtimeEvent(event.data));

      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") setStatus("实时连接失败");
        if (pc.connectionState === "connected") setStatus("面试进行中");
        if (pc.connectionState === "disconnected") setStatus("实时连接已断开");
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: offer.sdp,
          jobDescription,
          language,
          brief
        })
      });

      const answer = await response.text();
      if (!response.ok) {
        let message = "创建实时面试会话失败";
        try {
          message = JSON.parse(answer).error || message;
        } catch {
          message = answer || message;
        }
        throw new Error(message);
      }

      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setPhase("live");
      setStatus("面试进行中");
    } catch (startError) {
      stopRealtime();
      setError(startError instanceof Error ? startError.message : "无法开始语音面试");
      setStatus("连接失败");
    } finally {
      setIsConnecting(false);
    }
  }

  function sendRealtimeEvent(event: Record<string, unknown>) {
    const dataChannel = dataChannelRef.current;
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify(event));
    }
  }

  function handleRealtimeEvent(raw: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    const type = String(event.type || "");
    if (type === "response.output_audio_transcript.delta" || type === "response.output_text.delta") {
      assistantDraftRef.current += String(event.delta || "");
    }

    if (type === "response.output_audio_transcript.done" || type === "response.output_text.done") {
      const text = String(event.transcript || event.text || assistantDraftRef.current).trim();
      assistantDraftRef.current = "";
      if (text) appendTranscript("interviewer", text);
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = String(event.transcript || "").trim();
      if (text) appendTranscript("candidate", text);
    }

    if (type === "error") {
      const errorEvent = event.error as { message?: string } | undefined;
      setError(errorEvent?.message || "实时会话发生错误");
    }
  }

  function appendTranscript(role: TranscriptEntry["role"], text: string) {
    setTranscript((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role,
        text,
        at: new Date().toISOString()
      }
    ]);
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    setStatus(nextMuted ? "麦克风已暂停" : "面试进行中");
  }

  function stopRealtime() {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    analyserCleanupRef.current?.();

    dataChannelRef.current = null;
    peerConnectionRef.current = null;
    localStreamRef.current = null;
    audioElementRef.current = null;
    analyserCleanupRef.current = null;
    assistantDraftRef.current = "";
    setMicLevel(0);
    setIsMuted(false);
  }

  async function finishInterview() {
    stopRealtime();
    setPhase("review");
    setIsGeneratingFeedback(true);
    setError("");
    setStatus("AI 正在生成复盘");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch("/api/interview/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, language, transcript }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成反馈失败");

      setFeedback(data.feedback);
      if (brief) {
        const item: InterviewHistoryItem = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          language,
          jdSummary,
          brief,
          transcript,
          feedback: data.feedback
        };
      setHistory(saveHistoryItem(window.localStorage, item));
      }
      setStatus("复盘已生成");
    } catch (feedbackError) {
      setError(readUiError(feedbackError, "生成反馈超时或失败，请检查 OPENAI_API_KEY 后重试。"));
      setStatus("复盘失败");
    } finally {
      window.clearTimeout(timeout);
      setIsGeneratingFeedback(false);
    }
  }

  function startMicMeter(stream: MediaStream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    analyser.fftSize = 256;
    source.connect(analyser);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      setMicLevel(Math.min(100, Math.round((average / 128) * 100)));
      frame = requestAnimationFrame(tick);
    };
    tick();

    analyserCleanupRef.current = () => {
      cancelAnimationFrame(frame);
      context.close();
    };
  }

  function resetSession() {
    stopRealtime();
    setPhase("setup");
    setBrief(null);
    setFeedback(emptyFeedback);
    setTranscript([]);
    setStatus("等待岗位描述");
    setError("");
  }

  async function copyTranscript() {
    const text = transcript.map((entry) => `${entry.role}: ${entry.text}`).join("\n\n");
    await navigator.clipboard.writeText(text);
    setStatus("Transcript 已复制");
  }

  return (
    <main className="shell">
      <section className="workspace">
        <aside className="setup-panel">
          <div className="brand-row">
            <div>
              <p className="eyebrow">AI Voice Interview</p>
              <h1>模拟面试工作台</h1>
            </div>
            <span className="status-pill">{status}</span>
          </div>

          <div className="field-block">
            <label htmlFor="jd">岗位描述</label>
            <textarea
              id="jd"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="粘贴 JD，或上传 .txt/.md/.pdf/.docx 文件..."
            />
            <div className="upload-row">
              <input
                id="file-upload"
                type="file"
                accept=".txt,.md,.pdf,.docx"
                onChange={(event) => handleFileUpload(event.target.files?.[0] || null)}
              />
              <label className="file-button" htmlFor="file-upload" title="上传岗位描述文件">
                ↑ 上传 JD
              </label>
              <span>{jobDescription.trim().length} characters</span>
            </div>
          </div>

          <div className="settings-grid">
            <div className="field-block compact">
              <label>面试语言</label>
              <div className="segmented">
                <button
                  className={language === "zh" ? "active" : ""}
                  onClick={() => setLanguage("zh")}
                  type="button"
                >
                  中文
                </button>
                <button
                  className={language === "en" ? "active" : ""}
                  onClick={() => setLanguage("en")}
                  type="button"
                >
                  English
                </button>
              </div>
            </div>
            <div className="ai-disclosure">
              语音由 AI 生成，不是真人面试官。
            </div>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <div className="action-row">
            <button className="prepare-button" disabled={!canPrepare} onClick={generateBrief} type="button">
              {isLoadingBrief ? "准备中..." : "准备语音面试"}
            </button>
            <button className="secondary" onClick={resetSession} type="button">
              重置
            </button>
          </div>
          <p className="action-hint">{prepareHint}</p>
        </aside>

        <section className="main-panel">
          {phase === "setup" ? (
            <EmptyState history={history} onLoadHistory={setFeedbackFromHistory} />
          ) : null}

          {brief && phase !== "setup" ? (
            <InterviewSessionView
              brief={brief}
              language={language}
              phase={phase}
              isConnecting={isConnecting}
              isMuted={isMuted}
              micLevel={micLevel}
              transcript={transcript}
              onStart={startInterview}
              onMute={toggleMute}
              onFinish={finishInterview}
            />
          ) : null}

          {phase === "review" ? (
            <FeedbackView
              feedback={feedback}
              isGenerating={isGeneratingFeedback}
              transcript={transcript}
              onCopyTranscript={copyTranscript}
            />
          ) : null}
        </section>
      </section>
    </main>
  );

  function setFeedbackFromHistory(item: InterviewHistoryItem) {
    setBrief(item.brief);
    setFeedback(item.feedback);
    setTranscript(item.transcript);
    setPhase("review");
    setStatus("已加载历史记录");
  }
}

function readUiError(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function EmptyState({
  history,
  onLoadHistory
}: {
  history: InterviewHistoryItem[];
  onLoadHistory: (item: InterviewHistoryItem) => void;
}) {
  return (
    <div className="empty-layout">
      <div className="empty-copy">
        <p className="eyebrow">Ready when you are</p>
        <h2>上传岗位描述后，AI 会准备一场实时语音面试。</h2>
      </div>
      <HistoryList history={history} onLoadHistory={onLoadHistory} />
    </div>
  );
}

function InterviewSessionView({
  brief,
  language,
  phase,
  isConnecting,
  isMuted,
  micLevel,
  transcript,
  onStart,
  onMute,
  onFinish
}: {
  brief: InterviewBrief;
  language: InterviewLanguage;
  phase: InterviewPhase;
  isConnecting: boolean;
  isMuted: boolean;
  micLevel: number;
  transcript: TranscriptEntry[];
  onStart: () => void;
  onMute: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="interview-stack">
      <div className="brief-header">
        <div>
          <p className="eyebrow">{languageLabel(language)} Interview</p>
          <h2>{brief.roleTitle}</h2>
          <p>{brief.seniority}</p>
        </div>
        {phase === "brief" ? (
          <button disabled={isConnecting} onClick={onStart} type="button">
            {isConnecting ? "连接中..." : "开始语音面试"}
          </button>
        ) : (
          <div className="live-controls">
            <button className="secondary icon-button" onClick={onMute} title="暂停或恢复麦克风" type="button">
              {isMuted ? "▶" : "Ⅱ"}
            </button>
            <button className="danger" onClick={onFinish} type="button">
              结束并复盘
            </button>
          </div>
        )}
      </div>

      <div className="meter-row">
        <span>Mic</span>
        <div className="meter-track">
          <div style={{ width: `${micLevel}%` }} />
        </div>
        <span>{isMuted ? "Paused" : "Live"}</span>
      </div>

      <TranscriptPanel transcript={transcript} />
    </div>
  );
}

function TranscriptPanel({ transcript }: { transcript: TranscriptEntry[] }) {
  return (
    <div className="transcript-panel">
      <div className="section-title">
        <h3>实时记录</h3>
        <span>{transcript.length} turns</span>
      </div>
      <div className="transcript-list">
        {transcript.length ? (
          transcript.map((entry) => (
            <article key={entry.id} className={`transcript-entry ${entry.role}`}>
              <span>{entry.role === "interviewer" ? "Interviewer" : "Candidate"}</span>
              <p>{entry.text}</p>
            </article>
          ))
        ) : (
          <p className="muted">面试开始后，这里会显示双方转写内容。</p>
        )}
      </div>
    </div>
  );
}

function FeedbackView({
  feedback,
  isGenerating,
  transcript,
  onCopyTranscript
}: {
  feedback: InterviewFeedback;
  isGenerating: boolean;
  transcript: TranscriptEntry[];
  onCopyTranscript: () => void;
}) {
  if (isGenerating) {
    return <div className="review-loading">正在生成复盘报告...</div>;
  }

  return (
    <div className="feedback-grid">
      <div className="score-card">
        <span>总体评分</span>
        <strong>{feedback.overallScore}</strong>
        <p>{feedback.summary}</p>
      </div>
      <FeedbackList title="关键优势" items={feedback.strengths} />
      <FeedbackList title="风险点" items={feedback.risks} />
      <FeedbackList title="下一轮练习" items={feedback.nextPractice} />
      <div className="question-feedback">
        <div className="section-title">
          <h3>逐题反馈</h3>
          <button className="secondary" disabled={!transcript.length} onClick={onCopyTranscript} type="button">
            复制 transcript
          </button>
        </div>
        {feedback.questionFeedback.length ? (
          feedback.questionFeedback.map((item) => (
            <article key={`${item.question}-${item.assessment}`}>
              <h4>{item.question}</h4>
              <p>{item.assessment}</p>
              <small>{item.suggestion}</small>
            </article>
          ))
        ) : (
          <p className="muted">暂无逐题反馈。</p>
        )}
      </div>
    </div>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="feedback-list">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">暂无内容。</p>
      )}
    </div>
  );
}

function HistoryList({
  history,
  onLoadHistory
}: {
  history: InterviewHistoryItem[];
  onLoadHistory: (item: InterviewHistoryItem) => void;
}) {
  return (
    <div className="history-panel">
      <div className="section-title">
        <h3>最近记录</h3>
        <span>{history.length}</span>
      </div>
      {history.length ? (
        history.map((item) => (
          <button key={item.id} className="history-item" onClick={() => onLoadHistory(item)} type="button">
            <strong>{item.brief.roleTitle}</strong>
            <span>{new Date(item.createdAt).toLocaleString()}</span>
            <p>{item.jdSummary}</p>
          </button>
        ))
      ) : (
        <p className="muted">完成一次面试后会保存在这里。</p>
      )}
    </div>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
