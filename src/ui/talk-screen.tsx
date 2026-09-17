"use client";
import { useEffect, useRef, useState } from "react";
import MicCapture from "@/ui/mic-capture";
import ResultCard from "@/ui/result-card";
import { fetchJson } from "@/ui/api-client";

interface DictationStatus {
  id: string;
  storyId: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript: string | null;
  wordCount: number | null;
  durationSeconds: number | null;
  summary: string | null;
  processedAt: string | null;
}

type Stage =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "active"; id: string; status: DictationStatus }
  | { kind: "error"; detail: DictationStatus | null; message: string };

type InputMode = "speak" | "write";

export default function TalkScreen({ storyId }: { storyId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [mode, setMode] = useState<InputMode>("speak");
  const [text, setText] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const poll = (dictationId: string) => {
    const tick = async () => {
      try {
        const status = await fetchJson<DictationStatus>(
          `/api/dictations/${encodeURIComponent(dictationId)}`,
          {  },
        );
        setStage({ kind: "active", id: dictationId, status });
        if (status.status === "completed" || status.status === "failed") {
          clearPoll();
          if (status.status === "completed") {
            window.dispatchEvent(new CustomEvent("novel-os:world-changed", { detail: { storyId } }));
          }
        }
      } catch (error) {
        clearPoll();
        setStage({ kind: "error", detail: null, message: (error as Error).message });
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 3000);
  };

  const uploadAudio = async (blob: Blob, mimeType: string) => {
    setStage({ kind: "uploading" });
    clearPoll();
    const form = new FormData();
    form.append("storyId", storyId);
    form.append("audio", new Blob([blob], { type: mimeType || "audio/webm" }), `take-${blob.size}.webm`);
    try {
      const { dictationId } = await fetchJson<{ dictationId: string; jobId: string }>(
        "/api/dictations",
        { method: "POST", body: form },
      );
      poll(dictationId);
    } catch (error) {
      setStage({ kind: "error", detail: null, message: (error as Error).message });
    }
  };

  const submitText = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || stage.kind === "uploading") return;
    setStage({ kind: "uploading" });
    clearPoll();
    try {
      const { dictationId } = await fetchJson<{ dictationId: string }>(
        `/api/stories/${encodeURIComponent(storyId)}/extract-text`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        },
      );
      setText("");
      poll(dictationId);
    } catch (error) {
      setStage({ kind: "error", detail: null, message: (error as Error).message });
    }
  };

  const reset = () => {
    clearPoll();
    setStage({ kind: "idle" });
  };

  const busy = stage.kind === "uploading";
  const current: DictationStatus | null =
    stage.kind === "active" ? stage.status : stage.kind === "error" ? stage.detail : null;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900">Talk</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Dictate your next scene, type it out, or mix both. The extractor turns it into your story
        bible.
      </p>

      {stage.kind !== "active" && (
        <div className="mb-8">
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("speak")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                mode === "speak"
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              Speak
            </button>
            <button
              type="button"
              onClick={() => setMode("write")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                mode === "write"
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              Write
            </button>
          </div>

          {mode === "speak" ? (
            <MicCapture onAudio={uploadAudio} busy={busy} />
          ) : (
            <form onSubmit={submitText} className="space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write a scene, describe a character, or add any story detail…"
                rows={10}
                className="w-full resize-y rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">
                  {text.trim() ? `${text.trim().split(/\s+/).filter(Boolean).length} words` : ""}
                </span>
                <button
                  type="submit"
                  disabled={busy || !text.trim()}
                  className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {busy ? "Processing…" : "Extract to story bible"}
                </button>
              </div>
            </form>
          )}

          {stage.kind === "error" && (
            <p className="mt-2 text-sm text-red-600">{stage.message}</p>
          )}
        </div>
      )}

      {current && (
        <ResultCard
          status={current.status}
          transcript={current.transcript}
          summary={current.summary}
          wordCount={current.wordCount}
          onReset={reset}
        />
      )}
    </div>
  );
}
