"use client";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { groupOptions } from "@/lib/combobox";
import { cx, inputClass } from "./ui";

/**
 * A searchable dropdown for picking from a list while still allowing a free-typed value — replacement
 * for a plain `<input list="…">`, whose "dropdown" is a browser-native autocomplete popup that renders
 * inconsistently (empty until the field has focus, no visible affordance, no keyboard highlight).
 */
export function Combobox({
  value,
  onChange,
  options,
  popular = [],
  placeholder,
  groupLabel = "All",
  popularLabel = "Popular",
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Shown first, before the rest of the list, while the search box is empty. */
  popular?: string[];
  placeholder?: string;
  groupLabel?: string;
  popularLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  // Whether the box should filter by what's typed, as opposed to showing the full grouped list.
  // This can't be inferred from `query === value`: `onChange` feeds straight back into `value` on
  // every keystroke here, so the two are equal again the moment the parent re-renders — which would
  // make the list snap back to "show everything" after the very first character.
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // The field can be filled in from elsewhere (e.g. importing a job posting); keep the box in sync.
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const { popular: popularShown, rest } = groupOptions(options, popular, query, filtering);
  const flat = [...popularShown, ...rest];

  function select(option: string) {
    onChange(option);
    setQuery(option);
    setFiltering(false);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) select(flat[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setFiltering(false);
      setQuery(value);
    }
  }

  return (
    <div ref={root} className="relative">
      <div className="relative">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={cx(inputClass, "pr-8")}
          placeholder={placeholder}
          value={query}
          onFocus={() => {
            setOpen(true);
            setFiltering(false); // browsing from scratch: show everything, not just what matches the current value
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value); // free text is a valid value even without picking a suggestion
            setFiltering(true);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show options"
          onClick={() => setOpen((o) => !o)}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-slate-400 hover:text-slate-600"
        >
          <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && flat.length > 0 && (
        <ul id={listboxId} role="listbox" className="absolute z-20 mt-1.5 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {popularShown.length > 0 && <li className="px-3 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{popularLabel}</li>}
          {popularShown.map((option) => (
            <Option key={option} option={option} active={flat.indexOf(option) === active} selected={option === value} onSelect={select} />
          ))}
          {rest.length > 0 && popularShown.length > 0 && <li className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{groupLabel}</li>}
          {rest.map((option) => (
            <Option key={option} option={option} active={flat.indexOf(option) === active} selected={option === value} onSelect={select} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Option({ option, active, selected, onSelect }: { option: string; active: boolean; selected: boolean; onSelect: (option: string) => void }) {
  return (
    <li
      role="option"
      aria-selected={selected}
      // onMouseDown (not onClick) fires before the input's onBlur/click-outside handler can close the list.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(option);
      }}
      className={cx("flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm", active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-50")}
    >
      {option}
      {selected && <Check className="h-3.5 w-3.5 text-brand-600" />}
    </li>
  );
}
