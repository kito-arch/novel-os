"use client";
import { useRef, useState } from "react";

interface MicCaptureProps {
  onAudio: (blob: Blob, mimeType: string) => Promise<void>;
  busy: boolean;
}

function mimeTypeFromParts(parts: BlobPart[]): string {
  const sample = parts.find((part) => part instanceof Blob) as Blob | undefined;
  return sample?.type || "audio/webm";
}

// T13.3 — Microphone capture. Uses MediaRecorder where available and degrades
// to a file picker on desktop browsers without getUserMedia. Stops the track
// after each take so the mic light goes off.
export default function MicCapture({ onAudio, busy }: MicCaptureProps) {
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const stop = () => {
    const recorder = recorderRef.current;
    recorder?.stop();
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
  };

  const begin = async () => {
    if (!(navigator.mediaDevices && "getUserMedia" in navigator.mediaDevices)) {
      fileRef.current?.click();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRef.current = stream;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeFromParts(chunksRef.current) });
      setRecording(false);
      void onAudio(blob, blob.type);
    };
    recorder.start();
    setRecording(true);
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onAudio(file, file.type || "audio/webm");
    event.target.value = "";
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={recording ? stop : begin}
        className={`relative inline-flex h-16 w-16 items-center justify-center rounded-full text-sm font-medium transition ${
          busy
            ? "cursor-not-allowed bg-neutral-200 text-neutral-400"
            : recording
              ? "animate-pulse bg-red-600 text-white"
              : "bg-neutral-900 text-white hover:bg-neutral-700"
        }`}
      >
        {busy ? "…" : recording ? "■" : "●"}
      </button>
      <p className="text-sm text-neutral-500">
        {busy ? "Processing…" : recording ? "Recording — tap to stop" : "Tap to talk about your story"}
      </p>
      <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={onFile} />
    </div>
  );
}