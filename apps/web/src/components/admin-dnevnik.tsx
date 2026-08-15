"use client";

// apps/web/src/components/admin-dnevnik.tsx
// CRUD nad Beta dnevnikom (F11.4 §6.5).
//
// Isti obrazac kao `admin-radnje.tsx`: optimistično čekanje kroz `useTransition`
// + `router.refresh()` posle svakog uspeha, poruke uz akciju, destruktivno
// dugme kao ghost sa `--danger` (dizajn sistem §7.1).

import { useRouter } from "next/navigation";
import { useEffect, useTransition, useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { ChangelogRow } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { formatDatum } from "@/lib/ui-tekst";
import { Button } from "./ui/button";
import { Input, Label, Textarea } from "./ui/input";

const TIP: Record<ChangelogRow["kind"], string> = {
  novo: "novo",
  promena: "promena",
  popravka: "popravka",
};

type Poruka = { ok: boolean; tekst: string };

type Props = {
  stavke: ChangelogRow[];
};

type Oblik = {
  title: string;
  kind: ChangelogRow["kind"];
  body: string;
  published: boolean;
};

const PRAZNO: Oblik = { title: "", kind: "promena", body: "", published: true };

export function AdminDnevnik({ stavke }: Props) {
  const router = useRouter();
  const [ceka, prenesi] = useTransition();
  const [radi, setRadi] = useState(false);
  const [poruka, setPoruka] = useState<Poruka | null>(null);
  const [oblik, setOblik] = useState<Oblik>(PRAZNO);
  const /** ID stavke koja se menja; `null` = nova stavka. */
    [menjam, setMenjam] = useState<number | null>(null);
  /** ID stavke koja čeka potvrdu brisanja. */
  const [brisem, setBrisem] = useState<number | null>(null);

  async function posalji(putanja: string, init: RequestInit) {
    setRadi(true);
    setPoruka(null);

    try {
      const res = await fetch(putanja, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      if (!res.ok) {
        const telo = (await res.json().catch(() => null)) as { greska?: string } | null;
        setPoruka({
          ok: false,
          tekst:
            telo?.greska ??
            (res.status === 404
              ? "Sesija je istekla ili nemaš prava. Osveži stranu i prijavi se ponovo."
              : "Izmena nije prošla."),
        });
        return;
      }

      const telo = (await res.json()) as { poruka?: string };
      setPoruka({ ok: true, tekst: telo.poruka ?? "Urađeno." });
      prenesi(() => router.refresh());
    } catch {
      setPoruka({ ok: false, tekst: "Veza sa serverom nije uspela. Pokušaj ponovo." });
    } finally {
      setRadi(false);
    }
  }

  function pocniNovu() {
    setMenjam(null);
    setOblik(PRAZNO);
    setPoruka(null);
    setBrisem(null);
  }

  function pocniIzmenu(s: ChangelogRow) {
    setMenjam(s.id);
    setOblik({ title: s.title, kind: s.kind, body: s.body ?? "", published: s.published });
    setPoruka(null);
    setBrisem(null);
  }

  function sacuvaj() {
    const telo = {
      title: oblik.title.trim(),
      kind: oblik.kind,
      body: oblik.body.trim() || null,
      published: oblik.published,
    };

    if (menjam === null) {
      void posalji("/api/admin/dnevnik", { method: "POST", body: JSON.stringify(telo) });
    } else {
      void posalji(`/api/admin/dnevnik/${menjam}`, {
        method: "PATCH",
        body: JSON.stringify(telo),
      });
    }
  }

  function obrisi(id: number) {
    if (brisem !== id) {
      setBrisem(id);
      return;
    }
    setBrisem(null);
    if (menjam === id) pocniNovu();
    void posalji(`/api/admin/dnevnik/${id}`, { method: "DELETE" });
  }

  const zauzeto = radi || ceka;

  return (
    <div className="grid gap-5 lg:grid-cols-[24rem_1fr]">
      {/* ── obrazac ─────────────────────────────────────── */}
      <section className="h-fit rounded-xl border border-border bg-bg-elev p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {menjam === null ? (
            <Plus className="h-4 w-4 text-accent-text" />
          ) : (
            <Pencil className="h-4 w-4 text-accent-text" />
          )}
          {menjam === null ? "Nova stavka" : `Menjam stavku #${menjam}`}
        </h2>

        <div className="mt-4 space-y-3">
          <label className="block">
            <Label>Naslov</Label>
            <Input
              value={oblik.title}
              maxLength={120}
              onChange={(e) => setOblik((o) => ({ ...o, title: e.target.value }))}
              placeholder="npr. Skeniranje sa dvorečnim gradom"
              disabled={zauzeto}
            />
          </label>

          <label className="block">
            <Label>Tip</Label>
            <select
              value={oblik.kind}
              onChange={(e) => setOblik((o) => ({ ...o, kind: e.target.value as Oblik["kind"] }))}
              disabled={zauzeto}
              className="h-10 w-full rounded-lg border border-border-strong bg-bg-elev px-3 text-sm text-fg shadow-sm outline-none transition-[border-color,box-shadow] hover:border-fg-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
            >
              {(Object.keys(TIP) as ChangelogRow["kind"][]).map((k) => (
                <option key={k} value={k}>
                  {TIP[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <Label>Tekst</Label>
            <Textarea
              rows={4}
              maxLength={2000}
              value={oblik.body}
              onChange={(e) => setOblik((o) => ({ ...o, body: e.target.value }))}
              placeholder="Šta je promenjeno i zašto…"
              disabled={zauzeto}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={oblik.published}
              onChange={(e) => setOblik((o) => ({ ...o, published: e.target.checked }))}
              disabled={zauzeto}
              className="h-4 w-4 accent-accent"
            />
            Objavljeno (vidi se u Beta dnevniku korisnika)
          </label>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={sacuvaj}
              disabled={zauzeto || oblik.title.trim().length < 3}
            >
              {zauzeto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {menjam === null ? "Objavi" : "Sačuvaj"}
            </Button>
            {menjam !== null && (
              <Button size="sm" variant="ghost" onClick={pocniNovu} disabled={zauzeto}>
                Odustani
              </Button>
            )}
          </div>

          {poruka && (
            <p
              role={poruka.ok ? "status" : "alert"}
              className={cn("text-xs", poruka.ok ? "text-accent-text" : "text-danger")}
            >
              {poruka.tekst}
            </p>
          )}
        </div>
      </section>

      {/* ── spisak ──────────────────────────────────────── */}
      <section className="space-y-2">
        {stavke.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">
            Dnevnik je prazan. Prva stavka se pojavljuje ovde — i u Beta dnevniku
            korisnika kad je objaviš.
          </p>
        ) : (
          stavke.map((s) => (
            <div
              key={s.id}
              className={cn(
                "rounded-xl border bg-bg-elev p-4 shadow-sm transition-colors",
                menjam === s.id ? "border-accent/50" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="num text-[11px] text-fg-faint">#{s.id}</span>
                    <span className="truncate">{s.title}</span>
                    {!s.published && (
                      <span className="rounded-full bg-bg-inset px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
                        nacrt
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span className="num">{formatDatum(s.shipped_at)}</span>
                    <span>·</span>
                    <span>{TIP[s.kind]}</span>
                    {s.from_feedback.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="num">
                          {s.from_feedback.length}{" "}
                          {s.from_feedback.length === 1 ? "utisak" : "utiska"} vezano
                        </span>
                      </>
                    )}
                  </p>
                  {s.body && <p className="mt-1.5 text-sm text-fg-muted">{s.body}</p>}
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pocniIzmenu(s)}
                    disabled={zauzeto}
                  >
                    <Pencil className="h-3 w-3" />
                    Izmeni
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => obrisi(s.id)}
                    disabled={zauzeto}
                    className="text-danger hover:bg-danger-wash hover:text-danger"
                  >
                    {brisem === s.id ? (
                      "Potvrdi?"
                    ) : (
                      <>
                        <Trash2 className="h-3 w-3" />
                        Obriši
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
