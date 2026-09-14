"use client";
import { useRef, useState } from "react";

interface ChapterCreateModalProps {
  onConfirm: (title: string) => void;
  onClose: () => void;
}

export default function ChapterCreateModal({ onConfirm, onClose }: ChapterCreateModalProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onConfirm(title.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">New chapter</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>
        <form onSubmit={submit} className="px-5 py-4">
          <label className="mb-1 block text-xs font-medium text-neutral-600">Chapter title</label>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Arrival"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
              Cancel
            </button>
            <button type="submit" disabled={!title.trim()}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
