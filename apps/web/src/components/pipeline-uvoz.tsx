"use client";

// Uvoz postojećeg pipeline Sheeta (F7 §4).
//
// Modal, ne zaseban ekran: uvoz je radnja koja se u životu naloga uradi jednom
// ili dvaput.
//
// Prekidač „troši kredite" je NAMERNO isključen na početku i namerno neugodan.
// Uvoz koji sam od sebe potroši trideset kredita je gori od uvoza koji ne uradi
// ništa — zato podrazumevano samo postavlja status onome što je već otključano,
// a izveštaj kaže koliko je ostalo i zašto.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { plural } from "@/lib/ui-tekst";
import type { ApiError } from "@/lib/search-types";
import type { UvozIzvestaj } from "@/lib/uvoz";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function PipelineUvoz() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [otvoren, setOtvoren] = useState(false);
  const [trosiKredite, setTrosiKredite] = useState(false);
  const [radim, setRadim] = useState(false);
  const [izvestaj, setIzvestaj] = useState<UvozIzvestaj | null>(null);
  const [greska, setGreska] = useState<string | null>(null);

  async function posalji() {
    const fajl = input.current?.files?.[0];
    if (!fajl) {
      setGreska("Izaberi CSV fajl.");
      return;
    }

    setRadim(true);
    setGreska(null);
    setIzvestaj(null);

    const form = new FormData();
    form.set("csv", fajl);
    form.set("trosiKredite", trosiKredite ? "da" : "ne");

    try {
      const res = await fetch("/api/uvoz", { method: "POST", body: form });
      const json = (await res.json()) as UvozIzvestaj | ApiError;

      if (!res.ok) {
        setGreska((json as ApiError).greska ?? "Uvoz nije uspeo.");
        return;
      }

      setIzvestaj(json as UvozIzvestaj);
      // Stranica je server komponenta i sama ne zna da su kartice stigle.
      router.refresh();
    } catch {
      setGreska("Nema veze sa serverom.");
    } finally {
      setRadim(false);
    }
  }

  return (
    <Dialog open={otvoren} onOpenChange={setOtvoren}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Upload className="h-4 w-4" />
          Uvezi Sheet
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Uvoz iz CSV-a</DialogTitle>
          <DialogDescription>
            Kolone: <span className="font-mono">naziv</span>,{" "}
            <span className="font-mono">telefon</span>, <span className="font-mono">grad</span>,{" "}
            <span className="font-mono">status</span>, <span className="font-mono">beleska</span>.
            Grad je obavezan, ostalo nije.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-5">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="w-full rounded-lg border border-dashed border-border-strong bg-bg-subtle/50 p-3 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent-ink hover:file:brightness-110"
          />

          <label className="flex items-start gap-2.5 rounded-xl border border-border bg-bg-subtle/50 p-3 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={trosiKredite}
              onChange={(e) => setTrosiKredite(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Otključaj prospekte kojih nemam —{" "}
              <strong className="text-fg">troši kredit po prospektu</strong>. Bez ovoga
              uvoz postavlja status samo onome što je već otključano.
            </span>
          </label>

          <Button
            type="button"
            variant="primary"
            onClick={() => void posalji()}
            disabled={radim}
            className="w-full"
          >
            {radim ? "Uvozim…" : "Uvezi"}
          </Button>

          {greska && <Alert variant="danger">{greska}</Alert>}

          {izvestaj && <Izvestaj i={izvestaj} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Izvestaj({ i }: { i: UvozIzvestaj }) {
  const redova = (n: number) => plural(n, "red", "reda", "redova");

  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-bg-subtle/50 px-3.5 py-3 text-xs">
      <p className="font-medium">
        Pročitano {i.procitano} {redova(i.procitano)}, uvezeno {i.uvezeno}.
      </p>

      <ul className="space-y-1 text-fg-muted">
        {i.zakljucano > 0 && (
          <li>
            {i.zakljucano} {redova(i.zakljucano)} je uparen, ali ti prospekti nisu otključani —
            uključi kvačicu iznad da ih otključaš.
          </li>
        )}
        {i.bezKredita > 0 && (
          <li>
            {i.bezKredita} {redova(i.bezKredita)} je ostalo bez kredita.
          </li>
        )}
        {i.dvosmisleno > 0 && (
          <li>
            {i.dvosmisleno} {redova(i.dvosmisleno)} odgovara na više prospekata — dopiši telefon
            da bi uparivanje bilo jednoznačno.
          </li>
        )}
        {i.nenadjeno > 0 && (
          <li>
            {i.nenadjeno} {redova(i.nenadjeno)} nema u bazi
            {i.primeriNenadjenih.length > 0 && ` (npr. ${i.primeriNenadjenih.join(", ")})`}.
          </li>
        )}
        {i.upozorenja.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
    </div>
  );
}
