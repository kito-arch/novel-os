"use client";
import { useRef, useState } from "react";
import { fetchJson, studioHeaders } from "./api-client";

interface MediaUploadProps {
  storyId: string;
  entityId: string;
  role: "portrait" | "gallery";
  label?: string;
  onUploaded: (id: string, url: string) => void;
}

export default function MediaUpload({ storyId, entityId, role, label, onUploaded }: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("role", role);
      const result = await fetchJson<{ id: string; url: string }>(
        `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entityId)}/media`,
        { method: "POST", headers: studioHeaders(), body: form },
      );
      onUploaded(result.id, result.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="inline-block">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
      >
        {uploading ? "Uploading…" : (label ?? `Upload ${role}`)}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
