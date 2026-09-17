"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import { BASE_KIND_CATALOG } from "@/domain/base-kinds";
import { coreEntityTypes } from "@/domain/builtins";
import type { Entity } from "@/domain/entities";
import type { AttributeValue, EntityType } from "@/domain/entity-types";
import { fetchJson } from "./api-client";

interface EntityCreateModalProps {
  storyId: string;
  entityTypes: EntityType[];
  initialTypeName?: string;
  onCreated: (entity: Entity) => void;
  onClose: () => void;
}

function mergedTypes(registered: EntityType[]): EntityType[] {
  const names = new Set(registered.map((t) => t.name.toLowerCase()));
  return [...registered, ...coreEntityTypes.filter((t) => !names.has(t.name.toLowerCase()))];
}

async function uploadMedia(
  storyId: string,
  entityId: string,
  file: File,
  role: "portrait" | "gallery",
): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  form.append("role", role);
  await fetchJson(
    `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entityId)}/media`,
    { method: "POST", body: form },
  );
}

export default function EntityCreateModal({
  storyId,
  entityTypes,
  initialTypeName,
  onCreated,
  onClose,
}: EntityCreateModalProps) {
  const types = mergedTypes(entityTypes);
  const defaultType = types.find((t) => t.name === (initialTypeName ?? "character")) ?? types[0];

  const [selectedTypeName, setSelectedTypeName] = useState(defaultType?.name ?? "");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portraitRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const selectedType = types.find((t) => t.name === selectedTypeName) ?? null;
  const supportsMedia = selectedType
    ? BASE_KIND_CATALOG[selectedType.baseKind].supportsMedia
    : false;

  const setAttr = (key: string, value: string) =>
    setAttrs((prev) => ({ ...prev, [key]: value }));

  const pickPortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPortraitFile(file);
    setPortraitPreview(URL.createObjectURL(file));
  };

  const pickGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setGalleryFiles((prev) => [...prev, ...files]);
    setGalleryPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
  };

  const removeGallery = (index: number) => {
    setGalleryFiles((prev) => prev.filter((_, i) => i !== index));
    setGalleryPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !selectedType) return;
    setSaving(true);
    setError(null);

    const attributes: Record<string, AttributeValue> = {};
    for (const def of selectedType.attributeDefs) {
      const raw = (attrs[def.key] ?? "").trim();
      if (!raw) continue;
      attributes[def.key] = def.multi
        ? raw.split(",").map((v) => v.trim()).filter(Boolean)
        : raw;
    }

    try {
      const entity = await fetchJson<Entity>(
        `/api/stories/${encodeURIComponent(storyId)}/entities`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            entityTypeName: selectedType.name,
            aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
            attributes,
          }),
        },
      );

      // Upload images after entity is created (needs entity id)
      if (supportsMedia) {
        if (portraitFile) await uploadMedia(storyId, entity.id, portraitFile, "portrait");
        for (const file of galleryFiles) {
          await uploadMedia(storyId, entity.id, file, "gallery");
        }
      }

      onCreated(entity);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" style={{ maxHeight: "90vh" }}>
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-neutral-900">New entity</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-y-auto">
          <div className="space-y-4 px-5 py-4">
            {/* Type selector */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Type</label>
              <select
                value={selectedTypeName}
                onChange={(e) => {
                  setSelectedTypeName(e.target.value);
                  setAttrs({});
                  setPortraitFile(null);
                  setPortraitPreview(null);
                  setGalleryFiles([]);
                  setGalleryPreviews([]);
                }}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
              >
                {types.map((type) => (
                  <option key={type.name} value={type.name}>
                    {type.pluralName.charAt(0).toUpperCase() + type.pluralName.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Portrait + gallery upload — only for supportsMedia types */}
            {supportsMedia && (
              <div>
                <label className="mb-2 block text-xs font-medium text-neutral-600">Portrait</label>
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 hover:border-neutral-400"
                    onClick={() => portraitRef.current?.click()}
                  >
                    {portraitPreview ? (
                      <Image
                        src={portraitPreview}
                        alt="portrait preview"
                        width={80}
                        height={80}
                        unoptimized
                        className="h-20 w-20 rounded-xl object-cover"
                      />
                    ) : (
                      <span className="text-2xl text-neutral-300">+</span>
                    )}
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => portraitRef.current?.click()}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                    >
                      {portraitPreview ? "Change portrait" : "Upload portrait"}
                    </button>
                    {portraitPreview && (
                      <button
                        type="button"
                        onClick={() => { setPortraitFile(null); setPortraitPreview(null); }}
                        className="block text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                    <p className="text-xs text-neutral-400">Optional · JPG, PNG, WebP</p>
                  </div>
                </div>
                <input ref={portraitRef} type="file" accept="image/*" className="hidden" onChange={pickPortrait} />

                <label className="mb-2 mt-4 block text-xs font-medium text-neutral-600">
                  Gallery images <span className="font-normal text-neutral-400">(optional)</span>
                </label>
                {galleryPreviews.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {galleryPreviews.map((src, i) => (
                      <div key={i} className="relative">
                        <Image
                          src={src}
                          alt={`gallery ${i + 1}`}
                          width={60}
                          height={60}
                          unoptimized
                          className="h-15 w-15 rounded-lg object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeGallery(i)}
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-xs text-neutral-500 shadow hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  + Add images
                </button>
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={pickGallery}
                />
              </div>
            )}

            {/* Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  selectedType?.baseKind === "character" ? "e.g. Sarah Okafor" : "e.g. The Citadel"
                }
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
              />
            </div>

            {/* Aliases */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Aliases{" "}
                <span className="font-normal text-neutral-400">(comma-separated, optional)</span>
              </label>
              <input
                type="text"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="e.g. Dr. Okafor, The Professor"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
              />
            </div>

            {/* Dynamic attributes */}
            {selectedType && selectedType.attributeDefs.length > 0 && (
              <div className="space-y-3 rounded-lg bg-neutral-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Attributes
                </p>
                {selectedType.attributeDefs.map((def) => (
                  <div key={def.key}>
                    <label className="mb-1 block text-xs font-medium text-neutral-600">
                      {def.label}
                      {def.required && <span className="ml-0.5 text-red-500">*</span>}
                      {def.multi && (
                        <span className="ml-1 font-normal text-neutral-400">(comma-separated)</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={attrs[def.key] ?? ""}
                      onChange={(e) => setAttr(def.key, e.target.value)}
                      required={def.required}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
