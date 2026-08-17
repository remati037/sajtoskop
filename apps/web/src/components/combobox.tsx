"use client";

// Select sa pretragom u dropdownu, bez ijedne zavisnosti od `cmdk`.
// `<select>` nema pretragu — sa 54 grada i 48 niša to je 100 klikova skrolovanja.
//
// Pretraga ide kroz `foldForSearch` iz shared paketa: „sabac" nalazi „Šabac",
// „djordje" nalazi „Đorđe". Bez toga bi korisnik morao da kuca dijakritiku.
// Zato ovo nije zamenjeno shadcn-ovim Command-om ni posle redizajna: srpsko
// preklapanje slova je poenta komponente, a ne stil.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { foldForSearch } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { Label } from "./ui/input";

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
      <label htmlFor={id}>
        <Label>{label}</Label>
      </label>

      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          // [Faza 4, 4.8] Čitač ekrana čuje KOJA je opcija označena (nalaz 7.3.2).
          aria-activedescendant={open && flat[active] ? `${id}-op-${active}` : undefined}
          autoComplete="off"
          className={cn(
            // Kontrola → `--border-strong` (§3.2.1); lista ispod je površina.
            "h-11 w-full rounded-xl border border-border-strong bg-bg-elev pl-3.5 pr-9 text-sm shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-fg-muted/70",
            "hover:border-fg-muted focus:border-accent focus:ring-2 focus:ring-accent/25",
            open && "border-accent ring-2 ring-accent/25",
          )}
          placeholder={selected ? selected.label : placeholder}
          // [Faza 4, 4.8] Otvaranje ne sme da sakrije izabranu vrednost — dok je
          // query prazan, prikazuje se izabrano (nalaz 7.3.2).
          value={open ? (query || (selected?.label ?? "")) : (selected?.label ?? "")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />

        <ChevronDown
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </div>

      {open && (
        <ul
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-72 w-full animate-uklizi overflow-y-auto rounded-xl border border-border bg-bg-elev p-1 shadow-hero"
        >
          {flat.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-fg-muted">Nema pogodaka.</li>
          )}

          {filtered.map((group) => (
            <li key={group.label}>
              {groups.length > 1 && (
                <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted/80">
                  {group.label}
                </div>
              )}
              <ul>
                {group.options.map((option) => {
                  const index = flat.indexOf(option);
                  const izabrana = option.value === value;
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        role="option"
                        id={`${id}-op-${index}`}
                        aria-selected={izabrana}
                        data-active={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => pick(option)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                          "data-[active=true]:bg-bg-hover",
                          izabrana && "font-medium",
                        )}
                      >
                        <span className="truncate">{option.label}</span>
                        {izabrana && <Check className="h-3.5 w-3.5 shrink-0 text-accent-text" />}
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
