"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import {
  speak,
  stopSpeaking,
  preloadVoices,
  startRecognition,
  type RecognitionHandle,
  type SpeechLang,
} from "@/lib/speech";

type Setup = {
  field: string;
  language: "ar" | "en" | "mixed";
  difficulty: "junior" | "mid" | "senior";
  questionCount: number;
};

type Turn = { question: string; questionLang: SpeechLang; answer: string };

type Evaluation = {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

type Tip = { id: number; severity: "good" | "warn"; text: string };

type Report = {
  overallScore: number;
  verdict: "strong" | "good" | "needs_work";
  summary: string;
  contentFeedback: string;
  languageFeedback: string;
  bodyLanguageFeedback: string;
  tips: string[];
};

const FRAME_INTERVAL_MS = 10_000;

const FIELDS = [
  "هندسة برمجيات",
  "تسويق",
  "محاسبة ومالية",
  "موارد بشرية",
  "طب وتمريض",
  "مبيعات",
];

export default function InterviewPage() {
  const [phase, setPhase] = useState<"setup" | "session" | "report">("setup");

  // --- setup state ---
  const [field, setField] = useState("");
  const [language, setLanguage] = useState<Setup["language"]>("mixed");
  const [difficulty, setDifficulty] = useState<Setup["difficulty"]>("mid");
  const [questionCount, setQuestionCount] = useState(4);
  const [voiceSampleUrl, setVoiceSampleUrl] = useState<string | null>(null);
  const [recordingSample, setRecordingSample] = useState(false);

  // --- session state ---
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<{ text: string; lang: SpeechLang } | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [lastEval, setLastEval] = useState<Evaluation | null>(null);
  const [tips, setTips] = useState<Tip[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sttSupported, setSttSupported] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<RecognitionHandle | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bodyNotesRef = useRef<string[]>([]);
  const answerRef = useRef("");
  const tipIdRef = useRef(0);
  const sampleRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    preloadVoices();
    return () => cleanupSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupSession() {
    stopSpeaking();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // ---------- setup: optional mic sample ----------
  async function toggleSampleRecording() {
    if (recordingSample) {
      sampleRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        setVoiceSampleUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
        setRecordingSample(false);
        stream.getTracks().forEach((t) => t.stop());
      };
      sampleRecorderRef.current = recorder;
      recorder.start();
      setRecordingSample(true);
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 10_000);
    } catch {
      setError("ما قدرنا نوصل للمايك. اسمح بالوصول من إعدادات المتصفح.");
    }
  }

  // ---------- session ----------
  const setup: Setup = { field, language, difficulty, questionCount };

  async function startInterview() {
    if (!field.trim()) {
      setError("اكتب مجالك أولاً (مثلاً: هندسة برمجيات).");
      return;
    }
    setError(null);
    setPhase("session");
    setTurns([]);
    setLastEval(null);
    setTips([]);
    bodyNotesRef.current = [];

    // Camera for live body-language coaching.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
    } catch {
      setCameraOn(false);
    }

    await fetchNext([]);
  }

  async function fetchNext(currentTurns: Turn[]) {
    setThinking(true);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "next", setup: { ...setup, field }, turns: currentTurns }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      if (data.evaluation) setLastEval(data.evaluation);
      const q = { text: data.question.text as string, lang: data.question.lang as SpeechLang };
      setQuestion(q);
      setAnswer("");
      answerRef.current = "";

      setSpeaking(true);
      await speak(`${data.interviewerNote} ${q.text}`, q.lang);
      setSpeaking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThinking(false);
    }
  }

  function captureFrame(): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.6).split(",")[1] ?? null;
  }

  async function analyzeFrame() {
    const frame = captureFrame();
    if (!frame || !question) return;
    try {
      const res = await fetch("/api/interview/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame, field, question: question.text }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tips: { severity: "good" | "warn"; text: string }[] };
      const fresh = (data.tips ?? []).slice(0, 3).map((t) => ({ ...t, id: ++tipIdRef.current }));
      setTips((prev) => [...fresh, ...prev].slice(0, 4));
      for (const t of fresh) {
        if (t.severity === "warn") bodyNotesRef.current.push(t.text);
      }
    } catch {
      /* live tips are best-effort */
    }
  }

  function startAnswering() {
    if (!question || answering) return;
    stopSpeaking();
    setSpeaking(false);
    setAnswering(true);

    const handle = startRecognition(question.lang, (text) => {
      answerRef.current = text;
      setAnswer(text);
    });
    recognitionRef.current = handle;
    if (!handle) setSttSupported(false);

    if (cameraOn) {
      void analyzeFrame();
      frameTimerRef.current = setInterval(() => void analyzeFrame(), FRAME_INTERVAL_MS);
    }
  }

  async function finishAnswering() {
    if (!question) return;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    setAnswering(false);

    const turn: Turn = {
      question: question.text,
      questionLang: question.lang,
      answer: answerRef.current || answer,
    };
    const nextTurns = [...turns, turn];
    setTurns(nextTurns);
    setQuestion(null);

    if (nextTurns.length >= questionCount) {
      await fetchReport(nextTurns);
    } else {
      await fetchNext(nextTurns);
    }
  }

  async function fetchReport(finalTurns: Turn[]) {
    setThinking(true);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "report",
          setup: { ...setup, field },
          turns: finalTurns,
          bodyNotes: bodyNotesRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setReport(data);
      setPhase("report");
      cleanupSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThinking(false);
    }
  }

  function restart() {
    cleanupSession();
    setPhase("setup");
    setReport(null);
    setTurns([]);
    setQuestion(null);
    setLastEval(null);
    setTips([]);
    setError(null);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl">🎤</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">محاكي المقابلات</h1>
              <p className="text-xs text-slate-500">ممتحن بصوت محترف · عربي + English · تحليل لغة الجسد</p>
            </div>
          </div>
          <Nav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {phase === "setup" && (
          <SetupCard
            field={field}
            setField={setField}
            language={language}
            setLanguage={setLanguage}
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            questionCount={questionCount}
            setQuestionCount={setQuestionCount}
            voiceSampleUrl={voiceSampleUrl}
            recordingSample={recordingSample}
            onToggleSample={toggleSampleRecording}
            onStart={startInterview}
          />
        )}

        {phase === "session" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* main column */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
                  <span>
                    السؤال {Math.min(turns.length + 1, questionCount)} من {questionCount}
                  </span>
                  {speaking && <span className="text-brand-600">🔊 الممتحن يتكلم…</span>}
                  {thinking && !speaking && (
                    <span className="flex items-center gap-1">
                      يفكّر
                      <span className="typing-dot">●</span>
                      <span className="typing-dot">●</span>
                      <span className="typing-dot">●</span>
                    </span>
                  )}
                </div>

                {question ? (
                  <p
                    className="text-lg font-semibold leading-relaxed"
                    dir={question.lang === "en" ? "ltr" : "rtl"}
                  >
                    {question.text}
                  </p>
                ) : (
                  <p className="text-slate-400">…</p>
                )}

                {question && (
                  <div className="mt-4">
                    <textarea
                      dir={question.lang === "en" ? "ltr" : "rtl"}
                      value={answer}
                      onChange={(e) => {
                        setAnswer(e.target.value);
                        answerRef.current = e.target.value;
                      }}
                      placeholder={
                        sttSupported
                          ? "إجابتك رح تظهر هنا وأنت تحكي (وتقدر تعدّلها)…"
                          : "المتصفح ما يدعم التعرف الصوتي — اكتب إجابتك هنا."
                      }
                      className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-brand-300"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!answering ? (
                        <button
                          onClick={startAnswering}
                          disabled={thinking || speaking}
                          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                        >
                          🎙️ ابدأ الإجابة
                        </button>
                      ) : (
                        <button
                          onClick={() => void finishAnswering()}
                          className="animate-pulse rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
                        >
                          ⏹️ أنهيت إجابتي
                        </button>
                      )}
                      {question && !answering && (
                        <button
                          onClick={() => {
                            setSpeaking(true);
                            void speak(question.text, question.lang).then(() => setSpeaking(false));
                          }}
                          disabled={speaking}
                          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          🔁 أعد السؤال
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {lastEval && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">تقييم إجابتك السابقة</h3>
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-bold ${
                        lastEval.score >= 7
                          ? "bg-green-100 text-green-700"
                          : lastEval.score >= 4
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {lastEval.score}/10
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{lastEval.feedback}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FeedbackList title="✅ نقاط قوة" items={lastEval.strengths} />
                    <FeedbackList title="🛠️ للتحسين" items={lastEval.improvements} />
                  </div>
                </div>
              )}
            </div>

            {/* side column: camera + live tips */}
            <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="relative aspect-[4/3] bg-slate-900">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="h-full w-full -scale-x-100 object-cover"
                  />
                  {!cameraOn && (
                    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-400">
                      الكاميرا مقفلة — تحليل لغة الجسد متوقف
                    </div>
                  )}
                  {answering && cameraOn && (
                    <span className="absolute start-2 top-2 flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-xs font-medium text-white">
                      ● مباشر
                    </span>
                  )}
                </div>
                <div className="px-4 py-2 text-xs text-slate-500">
                  تحليل لغة الجسد لحظياً أثناء إجابتك — الصور تُحلَّل ولا تُخزَّن.
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold">💡 ملاحظات لحظية</h3>
                {tips.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    تظهر هنا ملاحظات على وضعيتك ونظرتك للكاميرا وأنت تجاوب.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tips.map((t) => (
                      <li
                        key={t.id}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          t.severity === "warn"
                            ? "bg-amber-50 text-amber-800"
                            : "bg-green-50 text-green-700"
                        }`}
                      >
                        {t.severity === "warn" ? "⚠️" : "👍"} {t.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {phase === "report" && report && <ReportCard report={report} onRestart={restart} />}
      </main>
    </div>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-slate-500">{title}</h4>
      <ul className="space-y-1 text-sm text-slate-600">
        {items.map((s, i) => (
          <li key={i}>• {s}</li>
        ))}
      </ul>
    </div>
  );
}

function SetupCard(props: {
  field: string;
  setField: (v: string) => void;
  language: Setup["language"];
  setLanguage: (v: Setup["language"]) => void;
  difficulty: Setup["difficulty"];
  setDifficulty: (v: Setup["difficulty"]) => void;
  questionCount: number;
  setQuestionCount: (v: number) => void;
  voiceSampleUrl: string | null;
  recordingSample: boolean;
  onToggleSample: () => void;
  onStart: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-bold">جهّز مقابلتك 🎯</h2>
        <p className="mt-1 text-sm text-slate-500">
          ممتحن افتراضي بصوت محترف بمجالك يسألك أسئلة حقيقية بالعربي والإنقلش، ويقيّم إجاباتك
          ولغة جسدك من الكاميرا لحظياً.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">مجالك / الوظيفة</label>
            <input
              value={props.field}
              onChange={(e) => props.setField(e.target.value)}
              placeholder="مثال: هندسة برمجيات، تسويق رقمي…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-brand-300"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FIELDS.map((f) => (
                <button
                  key={f}
                  onClick={() => props.setField(f)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50"
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">لغة الأسئلة</label>
              <select
                value={props.language}
                onChange={(e) => props.setLanguage(e.target.value as Setup["language"])}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none"
              >
                <option value="mixed">عربي + English</option>
                <option value="ar">عربي فقط</option>
                <option value="en">English only</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">المستوى</label>
              <select
                value={props.difficulty}
                onChange={(e) => props.setDifficulty(e.target.value as Setup["difficulty"])}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none"
              >
                <option value="junior">مبتدئ</option>
                <option value="mid">متوسط</option>
                <option value="senior">خبير</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">عدد الأسئلة</label>
              <select
                value={props.questionCount}
                onChange={(e) => props.setQuestionCount(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none"
              >
                {[3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">🎙️ عينة صوتك (اختياري)</p>
                <p className="text-xs text-slate-500">
                  ١٠ ثوانٍ للتأكد من المايك ومعايرة تقييم طريقة كلامك. صوت الممتحن نفسه صوتُ
                  محترف — مو صوتك — ويُفعَّل الاستنساخ الكامل عند ربط مزوّد أصوات.
                </p>
              </div>
              <button
                onClick={props.onToggleSample}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${
                  props.recordingSample
                    ? "animate-pulse bg-red-600 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {props.recordingSample ? "⏹️ إيقاف" : props.voiceSampleUrl ? "🔁 إعادة" : "تسجيل"}
              </button>
            </div>
            {props.voiceSampleUrl && (
              <audio controls src={props.voiceSampleUrl} className="mt-3 h-9 w-full" />
            )}
          </div>

          <button
            onClick={props.onStart}
            className="w-full rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-brand-700"
          >
            ابدأ المقابلة 🚀
          </button>
          <p className="text-center text-xs text-slate-400">
            رح يطلب المتصفح إذن الكاميرا والمايك — الفيديو يُحلَّل لحظياً ولا يُسجَّل أو يُخزَّن.
          </p>
        </div>
      </div>
    </div>
  );
}

function ReportCard({ report, onRestart }: { report: Report; onRestart: () => void }) {
  const verdictLabel = {
    strong: { text: "أداء قوي — جاهز للمقابلة 💪", cls: "bg-green-100 text-green-700" },
    good: { text: "أداء جيد — شوية صقل وبتوصل ✨", cls: "bg-amber-100 text-amber-700" },
    needs_work: { text: "يحتاج تدريب — والتكرار يصنع الفرق 📈", cls: "bg-red-100 text-red-700" },
  }[report.verdict];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <div className="text-5xl font-black text-brand-600">{Math.round(report.overallScore)}</div>
        <div className="text-sm text-slate-400">من 100</div>
        <span className={`mt-3 inline-block rounded-full px-4 py-1.5 text-sm font-semibold ${verdictLabel.cls}`}>
          {verdictLabel.text}
        </span>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{report.summary}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ReportSection emoji="🧠" title="مضمون الإجابات" text={report.contentFeedback} />
        <ReportSection emoji="🗣️" title="اللغة والوضوح" text={report.languageFeedback} />
        <ReportSection emoji="🧍" title="لغة الجسد" text={report.bodyLanguageFeedback} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-2 font-semibold">🎯 تدرّب على هذي قبل المقابلة الحقيقية</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          {report.tips.map((t, i) => (
            <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
              {i + 1}. {t}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={onRestart}
        className="w-full rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-brand-700"
      >
        🔁 مقابلة جديدة
      </button>
    </div>
  );
}

function ReportSection({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-2 font-semibold">
        {emoji} {title}
      </h3>
      <p className="text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}
