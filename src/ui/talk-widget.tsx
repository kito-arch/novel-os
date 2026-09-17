"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import MicCapture from "./mic-capture";
import { fetchJson, studioHeaders } from "./api-client";

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
  | { kind: "error"; message: string };

type InputMode = "speak" | "write";

// Emitted when extraction completes so the scene editor can append the text.
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

// Extract sceneId from /story/[storyId]/scene/[sceneId]
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
          { headers: studioHeaders() },
        );
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
        { method: "POST", headers: studioHeaders(), body: form },
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
          headers: studioHeaders({ "content-type": "application/json" }),
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

  const reset = () => {
    clearPoll();
    setStage({ kind: "idle" });
    setAppended(false);
  };

  const appendToScene = () => {
    if (
      stage.kind !== "active" ||
      stage.status.status !== "completed" ||
      !stage.status.transcript ||
      !currentSceneId
    ) return;
    emitSceneAppend(currentSceneId, stage.status.transcript);
    setAppended(true);
  };

  const busy = stage.kind === "uploading";
  const dictation = stage.kind === "active" ? stage.status : null;
  const isCompleted = dictation?.status === "completed";
  const isProcessing = stage.kind === "uploading" || dictation?.status === "pending" || dictation?.status === "processing";

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-neutral-700 transition-colors sm:bottom-6 sm:right-6"
      >
        <span className="text-base">🎙</span>
        Narrate
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-2 sm:p-6 pointer-events-none">
          <div className="pointer-events-auto flex w-full max-w-sm flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-neutral-800">Narrate</p>
                <p className="text-xs text-neutral-400">
                  {currentSceneId
                    ? "Appended to scene · entities updated"
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
              {/* Only show input when not actively showing a result */}
              {!dictation && (
                <>
                  {/* Mode tabs */}
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

                  {stage.kind === "error" && (
                    <p className="text-xs text-red-600">{stage.message}</p>
                  )}
                </>
              )}

              {/* Result */}
              {dictation && (
                <div className="space-y-3">
                  {/* Status */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        dictation.status === "completed"
                          ? "bg-emerald-100 text-emerald-800"
                          : dictation.status === "failed"
                            ? "bg-red-100 text-red-800"
                            : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {dictation.status === "completed"
                        ? "Entities updated"
                        : dictation.status === "failed"
                          ? "Failed"
                          : "Processing…"}
                    </span>
                    {dictation.wordCount != null && (
                      <span className="text-xs text-neutral-400">{dictation.wordCount} words</span>
                    )}
                  </div>

                  {isProcessing && (
                    <p className="text-xs text-neutral-500">
                      Running extractor — building your story bible…
                    </p>
                  )}

                  {dictation.transcript && (
                    <div className="max-h-32 overflow-y-auto rounded-lg bg-neutral-50 p-3 text-xs italic text-neutral-600">
                      &ldquo;{dictation.transcript}&rdquo;
                    </div>
                  )}

                  {dictation.summary && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        What changed
                      </p>
                      <p className="whitespace-pre-wrap text-xs text-neutral-700">
                        {dictation.summary}
                      </p>
                    </div>
                  )}

                  {/* Append to scene */}
                  {isCompleted && currentSceneId && dictation.transcript && (
                    <button
                      type="button"
                      onClick={appendToScene}
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

                  {isCompleted && (
                    <button
                      type="button"
                      onClick={reset}
                      className="w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                    >
                      Narrate again
                    </button>
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
