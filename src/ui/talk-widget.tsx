"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import MicCapture from "./mic-capture";
import { fetchJson } from "./api-client";

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
  | { kind: "review"; id: string; transcript: string }
  | { kind: "error"; message: string };

type InputMode = "speak" | "write";

function emitSceneAppend(sceneId: string, text: string) {
  window.dispatchEvent(
    new CustomEvent("novel-os:scene-append", { detail: { sceneId, text } }),
  );
}

function emitWorldChanged(storyId: string) {
  window.dispatchEvent(
    new CustomEvent("novel-os:world-changed", { detail: { storyId } }),
  );
}

function sceneIdFromPath(pathname: string): string | null {
  const match = /\/story\/[^/]+\/scene\/([^/?#]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export default function TalkWidget({ storyId }: { storyId: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<InputMode>("speak");
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [appended, setAppended] = useState(false);

  // Review-stage state
  const [reviewText, setReviewText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentSceneId = sceneIdFromPath(pathname);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => clearPoll(), []);

  const poll = (dictationId: string) => {
    const tick = async () => {
      try {
        const status = await fetchJson<DictationStatus>(
          `/api/dictations/${encodeURIComponent(dictationId)}`,
          {  },
        );

        // Transcript ready but extraction not yet triggered — show review UI.
        if (status.status === "processing" && status.transcript) {
          clearPoll();
          setReviewText(status.transcript);
          setExtractResult(null);
          setExtractError(null);
          setAppended(false);
          setStage({ kind: "review", id: dictationId, transcript: status.transcript });
          return;
        }

        setStage({ kind: "active", id: dictationId, status });
        if (status.status === "completed" || status.status === "failed") {
          clearPoll();
          if (status.status === "completed") emitWorldChanged(storyId);
        }
      } catch (err) {
        clearPoll();
        setStage({ kind: "error", message: (err as Error).message });
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
    form.append(
      "audio",
      new Blob([blob], { type: mimeType || "audio/webm" }),
      `take-${blob.size}.webm`,
    );
    try {
      const { dictationId } = await fetchJson<{ dictationId: string; jobId: string }>(
        "/api/dictations",
        { method: "POST", body: form },
      );
      poll(dictationId);
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  };

  const submitText = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setStage({ kind: "uploading" });
    clearPoll();
    try {
      const { dictationId } = await fetchJson<{ dictationId: string }>(
        `/api/stories/${encodeURIComponent(storyId)}/extract-text`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            ...(currentSceneId ? { sceneId: currentSceneId } : {}),
          }),
        },
      );
      setText("");
      poll(dictationId);
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  };

  const handleExtract = async () => {
    if (stage.kind !== "review") return;
    setExtracting(true);
    setExtractError(null);
    try {
      const result = await fetchJson<{ summary: string | null }>(
        `/api/dictations/${encodeURIComponent(stage.id)}/extract`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transcript: reviewText,
            ...(currentSceneId ? { sceneId: currentSceneId } : {}),
          }),
        },
      );
      setExtractResult(result.summary ?? "No changes");
      emitWorldChanged(storyId);
    } catch (err) {
      setExtractError((err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const reset = () => {
    clearPoll();
    setStage({ kind: "idle" });
    setAppended(false);
    setExtractResult(null);
    setExtractError(null);
    setExtracting(false);
  };

  const busy = stage.kind === "uploading";
  const dictation = stage.kind === "active" ? stage.status : null;
  const isCompleted = dictation?.status === "completed";
  const isProcessing =
    stage.kind === "uploading" ||
    dictation?.status === "pending" ||
    dictation?.status === "processing";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-neutral-700 transition-colors sm:bottom-6 sm:right-6"
      >
        <span className="text-base">🎙</span>
        Narrate
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-2 sm:p-6 pointer-events-none">
          <div className="pointer-events-auto flex w-full max-w-sm flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-neutral-800">Narrate</p>
                <p className="text-xs text-neutral-400">
                  {currentSceneId
                    ? "Speak or write · add to scene or extract entities"
                    : "Speak or write — entities updated"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); reset(); }}
                className="text-neutral-400 hover:text-neutral-700"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4 p-4">
              {/* Input — hidden once a dictation is in flight or in review */}
              {stage.kind === "idle" && (
                <>
                  <div className="flex gap-1.5">
                    {(["speak", "write"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                          mode === m
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {mode === "speak" ? (
                    <MicCapture onAudio={uploadAudio} busy={busy} />
                  ) : (
                    <form onSubmit={submitText} className="space-y-2">
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Write a scene, describe a character, or add any story detail…"
                        rows={6}
                        className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-neutral-400">
                          {text.trim()
                            ? `${text.trim().split(/\s+/).filter(Boolean).length} words`
                            : ""}
                        </span>
                        <button
                          type="submit"
                          disabled={busy || !text.trim()}
                          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                        >
                          {busy ? "Processing…" : "Narrate"}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}

              {/* Error */}
              {stage.kind === "error" && (
                <>
                  <p className="text-xs text-red-600">{stage.message}</p>
                  <button
                    type="button"
                    onClick={reset}
                    className="w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                  >
                    Try again
                  </button>
                </>
              )}

              {/* Uploading / transcribing spinner */}
              {(stage.kind === "uploading" || (dictation && isProcessing)) && (
                <div className="space-y-2">
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                    {stage.kind === "uploading" ? "Uploading…" : "Transcribing audio…"}
                  </span>
                  <p className="text-xs text-neutral-500">
                    {stage.kind === "uploading"
                      ? "Sending audio to transcription service…"
                      : "Converting speech to text — this takes a few seconds…"}
                  </p>
                </div>
              )}

              {/* Write-mode completed result (no review step needed) */}
              {dictation && isCompleted && (
                <div className="space-y-3">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                    Entities updated
                  </span>
                  {dictation.wordCount != null && (
                    <p className="text-xs text-neutral-400">{dictation.wordCount} words processed</p>
                  )}
                  {dictation.summary && (
                    <p className="whitespace-pre-wrap text-xs text-neutral-700">{dictation.summary}</p>
                  )}
                  {currentSceneId && dictation.transcript && (
                    <button
                      type="button"
                      onClick={() => {
                        emitSceneAppend(currentSceneId, dictation.transcript!);
                        setAppended(true);
                      }}
                      disabled={appended}
                      className={`w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        appended
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                      }`}
                    >
                      {appended ? "✓ Added to scene" : "Add transcript to current scene"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                  >
                    Narrate again
                  </button>
                </div>
              )}

              {/* Review stage — shown after audio is transcribed, before LLM extraction */}
              {stage.kind === "review" && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Review transcript
                  </p>
                  <textarea
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    rows={6}
                    className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
                  />

                  {!extractResult && (
                    <div className="flex gap-2">
                      {currentSceneId && (
                        <button
                          type="button"
                          onClick={() => {
                            emitSceneAppend(currentSceneId, reviewText);
                            setAppended(true);
                          }}
                          disabled={appended}
                          className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                            appended
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                          }`}
                        >
                          {appended ? "✓ Added to scene" : "Add to scene"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleExtract}
                        disabled={extracting || !reviewText.trim()}
                        className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {extracting ? "Extracting…" : "Extract entities"}
                      </button>
                    </div>
                  )}

                  {extractError && (
                    <p className="text-xs text-red-600">{extractError}</p>
                  )}

                  {extractResult && (
                    <div className="space-y-2">
                      <p className="text-xs text-emerald-700">{extractResult}</p>
                      {currentSceneId && (
                        <button
                          type="button"
                          onClick={() => {
                            emitSceneAppend(currentSceneId, reviewText);
                            setAppended(true);
                          }}
                          disabled={appended}
                          className={`w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                            appended
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                          }`}
                        >
                          {appended ? "✓ Added to scene" : "Add to scene"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={reset}
                        className="w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                      >
                        Narrate again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
