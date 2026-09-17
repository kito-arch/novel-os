"use client";
import { useRef, useState } from "react";
import { fetchJson } from "./api-client";
import { Spinner } from "./loading";
import { useToast } from "./toast";

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
  const { toast } = useToast();

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("role", role);
      const result = await fetchJson<{ id: string; url: string }>(
        `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entityId)}/media`,
        { method: "POST", body: form },
      );
      onUploaded(result.id, result.url);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
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
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
      >
        {uploading && <Spinner size="sm" />}
        {uploading ? "Uploading…" : (label ?? `Upload ${role}`)}
      </button>
    </div>
  );
}
