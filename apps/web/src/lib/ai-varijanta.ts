// apps/web/src/lib/ai-varijanta.ts
// „Napiši drugačije" iz pregledača — jedan put za panel poruka i za karticu.
//
// Bez `server-only`: ovo je klijentski omotač oko tri postojeće rute
// (`POST /api/poruke/ai`, `GET /api/job/:id`, `GET /api/poruke/ai`). Do S30 je
// stajao unutar `poruke-panel.tsx`; kartica prospekta (§7.2) traži isto, a dve
// kopije pollovanja bi se razišle prvi put kad se promeni rok čekanja.

import type { MessageChannel } from "@sajtoskop/shared";
import type { ApiError } from "./search-types";

/** Isto pollovanje kao kod scana. `false` znači da posao nije završio uspešno. */
export async function sacekajPosao(jobId: number, doMs = 45_000): Promise<boolean> {
  const doKada = Date.now() + doMs;

  while (Date.now() < doKada) {
    // [Faza 4, 4.11] Skriven tab ne troši zahteve (P5) — čeka se dok se vrati.
    while (document.hidden) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    await new Promise((r) => setTimeout(r, 1200));

    const res = await fetch(`/api/job/${jobId}`, { cache: "no-store" });
    if (!res.ok) return false;

    const { status } = (await res.json()) as { status: string };
    if (status === "done") return true;
    if (status === "failed") return false;
  }

  return false;
}

export type IshodVarijante =
  | { ok: true; body: string; words: number }
  | { ok: false; status: number; greska: string };

/** Naruči varijantu, sačekaj posao, pročitaj tekst. Ne baca. */
export async function napisiVarijantu(
  placeId: string,
  kanal: MessageChannel,
): Promise<IshodVarijante> {
  try {
    const res = await fetch("/api/poruke/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId, channel: kanal }),
    });
    const json = (await res.json()) as { jobId: number } | ApiError;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        greska: (json as ApiError).greska ?? "Varijanta nije uspela.",
      };
    }

    const jobId = (json as { jobId: number }).jobId;
    if (!(await sacekajPosao(jobId))) {
      return {
        ok: false,
        status: 500,
        greska: "Pisanje varijante nije uspelo. Šablon iznad je i dalje upotrebljiv.",
      };
    }

    const gotov = await fetch(
      `/api/poruke/ai?placeId=${encodeURIComponent(placeId)}&channel=${kanal}&jobId=${jobId}`,
    );
    if (!gotov.ok) {
      // 404 ovde znači da je posao prošao, ali model nije dao ništa što prolazi
      // pravila kopija. Ruta za to vraća rečenicu koja to i kaže.
      const err = (await gotov.json()) as ApiError;
      return {
        ok: false,
        status: gotov.status,
        greska: err.greska ?? "Varijanta nije stigla. Pokušaj ponovo.",
      };
    }

    const varijanta = (await gotov.json()) as { body: string; words: number };
    return { ok: true, body: varijanta.body, words: varijanta.words };
  } catch {
    return { ok: false, status: 0, greska: "Nema veze sa serverom." };
  }
}
