"use client";

interface ResultCardProps {
  status: "pending" | "processing" | "completed" | "failed";
  transcript: string | null;
  summary: string | null;
  wordCount: number | null;
  error?: string;
  onReset: () => void;
}

function StatusPill({ status }: { status: ResultCardProps["status"] }) {
  const label = status === "completed" ? "Saved" : status === "failed" ? "Failed" : status === "processing" ? "Processing" : "Queued";
  const classes =
    status === "completed"
      ? "bg-emerald-100 text-emerald-800"
      : status === "failed"
        ? "bg-red-100 text-red-800"
        : status === "processing"
          ? "bg-blue-100 text-blue-800"
          : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

export default function ResultCard({ status, transcript, summary, wordCount, error, onReset }: ResultCardProps) {
  return (
    <div className="w-full rounded-xl border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <StatusPill status={status} />
        {wordCount !== null && wordCount !== undefined && (
          <span className="text-xs text-neutral-400">{wordCount} words</span>
        )}
      </div>

      {status !== "completed" && status !== "failed" && (
        <p className="text-sm text-neutral-500">
          {status === "pending"
            ? "Uploaded. Waiting for transcription and extraction…"
            : "Running the extractor — building your story bible…"}
        </p>
      )}

      {status === "failed" && (
        <p className="text-sm text-red-600">{error ?? "Something went wrong. Try again."}</p>
      )}

      {transcript && (
        <div className="mt-2 rounded-lg bg-neutral-50 p-3 text-sm italic text-neutral-700">
          “{transcript}”
        </div>
      )}

      {summary && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">What changed</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{summary}</p>
        </div>
      )}

      {status === "completed" && (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
        >
          Record another take
        </button>
      )}
    </div>
  );
}