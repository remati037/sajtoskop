"use client";

// Select sa pretragom u dropdownu, bez ijedne zavisnosti.
// shadcn/ui dolazi tek u F8 (F1, §9), a `<select>` nema pretragu — sa 54 grada i
// 48 niša to je 100 klikova skrolovanja.
//
// Pretraga ide kroz `foldForSearch` iz shared paketa: „sabac" nalazi „Šabac",
// „djordje" nalazi „Đorđe". Bez toga bi korisnik morao da kuca dijakritiku.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { foldForSearch } from "@sajtoskop/shared";

export type ComboOption = { value: string; label: string };
export type ComboGroup = { label: string; options: ComboOption[] };

type Props = {
  label: string;
  placeholder: string;
  groups: ComboGroup[];
  value: string | null;
  onChange: (value: string) => void;
};

export function Combobox({ label, placeholder, groups, value, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => groups.flatMap((g) => g.options).find((o) => o.value === value) ?? null,
    [groups, value],
  );

  const filtered = useMemo(() => {
    const q = foldForSearch(query.trim());
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, options: g.options.filter((o) => foldForSearch(o.label).includes(q)) }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  // Ravan niz zbog kretanja strelicama preko granica grupa.
  const flat = useMemo(() => filtered.flatMap((g) => g.options), [filtered]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(option: ComboOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + flat.length) % Math.max(flat.length, 1);
      });
    } else if (e.key === "Enter") {
      if (open && flat[active]) {
        e.preventDefault();
        pick(flat[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>

      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? "")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          {flat.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-500">Nema pogodaka.</li>
          )}

          {filtered.map((group) => (
            <li key={group.label}>
              {groups.length > 1 && (
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  {group.label}
                </div>
              )}
              <ul>
                {group.options.map((option) => {
                  const index = flat.indexOf(option);
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={option.value === value}
                        data-active={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => pick(option)}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm data-[active=true]:bg-neutral-100 dark:data-[active=true]:bg-neutral-800"
                      >
                        <span>{option.label}</span>
                        {option.value === value && <span className="text-xs text-neutral-400">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
