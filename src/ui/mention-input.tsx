"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";

// ── Serialisation ─────────────────────────────────────────────────────────────

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Stored text → editable HTML. Mentions become non-editable inline spans. */
function toHtml(text: string): string {
  MENTION_RE.lastIndex = 0;
  let html = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > last) html += esc(text.slice(last, m.index)).replace(/\n/g, "<br>");
    html += `<span contenteditable="false" data-entity-id="${esc(m[2])}" data-entity-name="${esc(m[1])}">`
          + `@${esc(m[1])}</span>`;
    last = m.index + m[0].length;
  }
  if (last < text.length) html += esc(text.slice(last)).replace(/\n/g, "<br>");
  return html;
}

/** Editable HTML → stored text. Inverse of toHtml. */
function fromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName === "BR") return "\n";
  if (node instanceof HTMLElement) {
    if (node.dataset.entityId)
      return `@[${node.dataset.entityName}](${node.dataset.entityId})`;
    const inner = Array.from(node.childNodes).map(fromNode).join("");
    // Chrome wraps new lines in <div>; treat each as a newline prefix
    return node.nodeName === "DIV" ? "\n" + inner : inner;
  }
  return "";
}

function serialize(el: HTMLElement): string {
  return Array.from(el.childNodes).map(fromNode).join("");
}

// ── Hover card ────────────────────────────────────────────────────────────────

function HoverCard({
  entity,
  entityType,
  anchor,
  storyId,
}: {
  entity: Entity;
  entityType: EntityType | undefined;
  anchor: DOMRect;
  storyId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ position: "fixed", opacity: 0, pointerEvents: "none" });

  useEffect(() => {
    const card = ref.current;
    if (!card) return;
    const ch = card.offsetHeight;
    const cw = card.offsetWidth;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow > ch + 8 ? anchor.bottom + 6 : anchor.top - ch - 6;
    const left = Math.min(Math.max(anchor.left, 8), window.innerWidth - cw - 8);
    setPos({ position: "fixed", top, left, zIndex: 300, opacity: 1, pointerEvents: "none" });
  }, [anchor]);

  const portrait = entity.media?.find((m) => m.role === "portrait");
  const href = `/story/${storyId}/entity/${entity.id}`;

  return (
    <div ref={ref} style={pos} className="w-64 rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        {portrait ? (
          <Image src={portrait.url} alt={entity.name} width={44} height={44} unoptimized
            className="h-11 w-11 shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 font-semibold">
            {entity.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <Link href={href} className="block truncate font-semibold text-neutral-900 hover:underline">
            {entity.name}
          </Link>
          {entityType && <p className="text-xs capitalize text-neutral-400">{entityType.name}</p>}
          {entity.aliases.length > 0 && (
            <p className="text-xs text-neutral-400">aka {entity.aliases.join(", ")}</p>
          )}
        </div>
      </div>
      {Object.entries(entity.attributes ?? {}).slice(0, 3).map(([key, val]) => {
        const def = entityType?.attributeDefs.find((d) => d.key === key);
        const display = Array.isArray(val) ? val.join(", ") : String(val);
        return (
          <div key={key} className="mt-1 flex gap-1.5 text-xs">
            <span className="shrink-0 font-medium text-neutral-500">{def?.label ?? key}:</span>
            <span className="truncate text-neutral-700">{display}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

interface DropdownState {
  query: string;
  rect: DOMRect;
  selected: number;
}

// ── Main component ────────────────────────────────────────────────────────────

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  entities: Entity[];
  entityTypes: EntityType[];
  storyId: string;
  highlightEntityId?: string;
  onEntityClick?: (entityId: string) => void;
  placeholder?: string;
}

export default function MentionInput({
  value,
  onChange,
  entities,
  entityTypes,
  storyId,
  highlightEntityId,
  onEntityClick,
  placeholder,
}: MentionInputProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef("");
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);
  const [hoverState, setHoverState] = useState<{ entity: Entity; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const typeById = useMemo(() => new Map(entityTypes.map((t) => [t.id, t])), [entityTypes]);

  // ── Initialise & sync external value changes ──
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    if (value === lastValueRef.current) return;
    el.innerHTML = toHtml(value);
    lastValueRef.current = value;
  }, [value]);

  // ── Scroll to / highlight a specific entity mention ──
  useEffect(() => {
    if (!highlightEntityId) return;
    const el = divRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-entity-id="${highlightEntityId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("mention-highlight");
    const t = setTimeout(() => target.classList.remove("mention-highlight"), 2000);
    return () => clearTimeout(t);
  }, [highlightEntityId, value]);

  // ── Detect @-trigger after each input ──
  const detectTrigger = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) { setDropdown(null); return; }
    const before = (node.textContent ?? "").substring(0, range.startOffset);
    const m = /@([^@\n]*)$/.exec(before);
    if (!m) { setDropdown(null); return; }
    const caretRect = range.getBoundingClientRect();
    setDropdown({ query: m[1], rect: caretRect, selected: 0 });
  }, []);

  const handleInput = useCallback(() => {
    const el = divRef.current;
    if (!el) return;
    const text = serialize(el);
    lastValueRef.current = text;
    onChange(text);
    detectTrigger();
  }, [onChange, detectTrigger]);

  // ── Insert a mention at the current caret ──
  const insertMention = useCallback((entity: Entity) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const before = (node.textContent ?? "").substring(0, range.startOffset);
    const atIdx = before.search(/@([^@\n]*)$/);
    if (atIdx === -1) return;

    // Delete @query
    const deleteRange = document.createRange();
    deleteRange.setStart(node, atIdx);
    deleteRange.setEnd(node, range.startOffset);
    deleteRange.deleteContents();

    // Build mention span
    const span = document.createElement("span");
    span.setAttribute("contenteditable", "false");
    span.dataset.entityId = entity.id;
    span.dataset.entityName = entity.name;
    span.textContent = `@${entity.name}`;

    // Trailing space so cursor lands outside the span
    const space = document.createTextNode(" ");

    deleteRange.insertNode(space);
    deleteRange.insertNode(span);

    // Move cursor after the space
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);

    // Sync
    const el = divRef.current!;
    const text = serialize(el);
    lastValueRef.current = text;
    onChange(text);
    setDropdown(null);
  }, [onChange]);

  // ── Keyboard nav in dropdown ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!dropdown) return;
    const candidates = entities
      .filter((en) => en.name.toLowerCase().includes(dropdown.query.toLowerCase()))
      .slice(0, 8);
    if (candidates.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDropdown((d) => d && { ...d, selected: Math.min(d.selected + 1, candidates.length - 1) });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDropdown((d) => d && { ...d, selected: Math.max(d.selected - 1, 0) });
    } else if (e.key === "Enter" || e.key === "Tab") {
      const pick = candidates[dropdown.selected];
      if (pick) { e.preventDefault(); insertMention(pick); }
    } else if (e.key === "Escape") {
      setDropdown(null);
    }
  }, [dropdown, entities, insertMention]);

  // ── Hover on mention spans (event delegation) ──
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-entity-id]");
    if (!target) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setHoverState(null), 200);
      return;
    }
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const entity = entityById.get(target.dataset.entityId!);
    if (!entity) return;
    setHoverState({ entity, rect: target.getBoundingClientRect() });
  }, [entityById]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverState(null), 200);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-entity-id]");
    if (!target || !onEntityClick) return;
    e.preventDefault();
    onEntityClick(target.dataset.entityId!);
  }, [onEntityClick]);

  const candidates = dropdown
    ? entities.filter((en) => en.name.toLowerCase().includes(dropdown.query.toLowerCase())).slice(0, 8)
    : [];

  return (
    <>
      {/* Editor */}
      <div
        ref={divRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        data-placeholder={placeholder}
        className={[
          "mention-editor min-h-[60vh] w-full font-serif text-[17px] leading-relaxed text-neutral-800",
          "focus:outline-none",
          "empty:before:content-[attr(data-placeholder)] empty:before:text-neutral-300 empty:before:pointer-events-none",
        ].join(" ")}
      />

      {/* Autocomplete dropdown */}
      {dropdown && candidates.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: dropdown.rect.bottom + 6,
            left: dropdown.rect.left,
            zIndex: 200,
          }}
          className="w-60 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
        >
          <p className="border-b border-neutral-100 px-3 py-1.5 text-xs text-neutral-400">
            {dropdown.query ? `"${dropdown.query}"` : "Type to filter"}
          </p>
          {candidates.map((en, i) => (
            <button
              key={en.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(en); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                i === dropdown.selected ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              <span className="flex-1 truncate font-medium">{en.name}</span>
              <span className={`text-xs ${i === dropdown.selected ? "text-neutral-300" : "text-neutral-400"}`}>
                {typeById.get(en.entityTypeId)?.name ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Hover card */}
      {hoverState && (
        <HoverCard
          entity={hoverState.entity}
          entityType={typeById.get(hoverState.entity.entityTypeId)}
          anchor={hoverState.rect}
          storyId={storyId}
        />
      )}

      <style>{`
        .mention-editor [data-entity-id] {
          display: inline-block;
          background: rgb(243 244 246);
          color: rgb(17 24 39);
          font-family: inherit;
          font-size: inherit;
          font-weight: 600;
          border-radius: 4px;
          padding: 0 4px;
          cursor: pointer;
          transition: background 0.15s;
          user-select: none;
        }
        .mention-editor [data-entity-id]:hover {
          background: rgb(229 231 235);
        }
        .mention-editor [data-entity-id].mention-highlight {
          background: rgb(254 240 138);
          animation: mention-flash 2s ease-out forwards;
        }
        @keyframes mention-flash {
          0%   { background: rgb(253 224 71); }
          100% { background: rgb(243 244 246); }
        }
      `}</style>
    </>
  );
}
