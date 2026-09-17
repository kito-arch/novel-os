"use client";
import { useState } from "react";
import type { EntityBaseKind } from "@/domain/base-kinds";
import type { AttributeKind } from "@/domain/entity-types";
import { fetchJson } from "./api-client";

interface AttrRow {
  key: string;
  label: string;
  kind: AttributeKind;
  required: boolean;
  multi: boolean;
}

interface EntityTypeCreateModalProps {
  storyId: string;
  onCreated: (typeName: string) => void;
  onClose: () => void;
}

const BASE_KIND_OPTIONS: { value: EntityBaseKind; label: string; hint: string }[] = [
  { value: "character", label: "Character", hint: "People, beings, AI agents — supports portrait" },
  { value: "place", label: "Place", hint: "Locations, worlds, regions — supports images" },
  { value: "physical", label: "Physical object", hint: "Ships, items, structures — supports images" },
  { value: "abstract", label: "Abstract", hint: "Factions, concepts, organisations — text only" },
];

const ATTR_KIND_OPTIONS: { value: AttributeKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "enum", label: "Enum (pick from list)" },
];

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function autoPlural(name: string): string {
  if (!name) return "";
  const n = name.trim().toLowerCase();
  if (n.endsWith("s") || n.endsWith("x") || n.endsWith("z")) return name + "es";
  if (n.endsWith("y") && !/[aeiou]y$/.test(n)) return name.slice(0, -1) + "ies";
  return name + "s";
}

export default function EntityTypeCreateModal({
  storyId,
  onCreated,
  onClose,
}: EntityTypeCreateModalProps) {
  const [name, setName] = useState("");
  const [pluralName, setPluralName] = useState("");
  const [pluralTouched, setPluralTouched] = useState(false);
  const [baseKind, setBaseKind] = useState<EntityBaseKind>("physical");
  const [description, setDescription] = useState("");
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!pluralTouched) setPluralName(autoPlural(value));
  };

  const addAttr = () =>
    setAttrs((prev) => [
      ...prev,
      { key: "", label: "", kind: "text", required: false, multi: false },
    ]);

  const updateAttr = (index: number, patch: Partial<AttrRow>) =>
    setAttrs((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // Auto-fill key from label if key untouched
        if ("label" in patch && !row.key) next.key = slugify(patch.label ?? "");
        return next;
      }),
    );

  const removeAttr = (index: number) =>
    setAttrs((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    const attributeDefs = attrs
      .filter((a) => a.key.trim() && a.label.trim())
      .map((a) => ({
        key: a.key.trim(),
        label: a.label.trim(),
        kind: a.kind,
        required: a.required,
        multi: a.multi,
      }));

    try {
      await fetchJson(`/api/stories/${encodeURIComponent(storyId)}/entity-types`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim().toLowerCase(),
          pluralName: (pluralName.trim() || autoPlural(name)).toLowerCase(),
          baseKind,
          description: description.trim() || null,
          attributeDefs,
        }),
      });
      onCreated(name.trim().toLowerCase());
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
        style={{ maxHeight: "90vh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-neutral-900">New entity type</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-y-auto">
          <div className="space-y-5 px-5 py-4">
            {/* Name + plural */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Type name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. starship"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Plural name
                </label>
                <input
                  type="text"
                  value={pluralName}
                  onChange={(e) => { setPluralName(e.target.value); setPluralTouched(true); }}
                  placeholder={autoPlural(name) || "e.g. starships"}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Base kind */}
            <div>
              <label className="mb-2 block text-xs font-medium text-neutral-600">
                Base kind <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {BASE_KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBaseKind(opt.value)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      baseKind === opt.value
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div
                      className={`mt-0.5 text-xs ${
                        baseKind === opt.value ? "text-neutral-300" : "text-neutral-400"
                      }`}
                    >
                      {opt.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Description <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Interstellar vessels in the fleet"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
              />
            </div>

            {/* Attribute definitions */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-600">
                  Attributes{" "}
                  <span className="font-normal text-neutral-400">(optional fields for each entity)</span>
                </label>
                <button
                  type="button"
                  onClick={addAttr}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  + Add field
                </button>
              </div>

              {attrs.length === 0 && (
                <p className="rounded-lg border border-dashed border-neutral-200 py-4 text-center text-xs text-neutral-400">
                  No attributes yet.{" "}
                  <button type="button" onClick={addAttr} className="underline">
                    Add a field
                  </button>{" "}
                  to give each {name || "entity"} structured properties.
                </p>
              )}

              <div className="space-y-2">
                {attrs.map((attr, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                  >
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-xs text-neutral-500">Label</label>
                        <input
                          type="text"
                          value={attr.label}
                          onChange={(e) => updateAttr(i, { label: e.target.value })}
                          placeholder="e.g. Class"
                          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:border-neutral-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-500">Key</label>
                        <input
                          type="text"
                          value={attr.key}
                          onChange={(e) => updateAttr(i, { key: e.target.value })}
                          placeholder="e.g. class"
                          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs text-neutral-900 focus:border-neutral-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={attr.kind}
                        onChange={(e) => updateAttr(i, { kind: e.target.value as AttributeKind })}
                        className="flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none"
                      >
                        {ATTR_KIND_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-neutral-600">
                        <input
                          type="checkbox"
                          checked={attr.required}
                          onChange={(e) => updateAttr(i, { required: e.target.checked })}
                          className="rounded"
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-1 text-xs text-neutral-600">
                        <input
                          type="checkbox"
                          checked={attr.multi}
                          onChange={(e) => updateAttr(i, { multi: e.target.checked })}
                          className="rounded"
                        />
                        Multiple
                      </label>
                      <button
                        type="button"
                        onClick={() => removeAttr(i)}
                        className="text-xs text-neutral-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

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
              {saving ? "Creating…" : "Create type"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
