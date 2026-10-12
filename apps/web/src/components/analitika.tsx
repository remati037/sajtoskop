"use client";

// Podiže analitiku i drži njen identitet u koraku sa Clerk sesijom.
//
// Stoji u `ClerkOkvir`-u, dakle na svakoj strani. Podizanje čeka da Clerk učita
// sesiju, pa prvi pregled strane već nosi nalog.
//
// `setTimeout(0)` nije ukras: ova komponenta je u stablu ISPRED strane, pa njen
// efekat ide pre efekta okvira koji zna da je nalog admin. Bez odlaganja bi
// adminov prvi pregled strane izašao pre nego što ga `useAnalitikaNaloga` ugasi.
//
// Ne crta ništa.

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  iskljuciAnalitiku,
  odveziKorisnika,
  opisiKorisnika,
  pokreniAnalitiku,
  poveziKorisnika,
} from "@/lib/analitika";

export function Analitika() {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    const t = setTimeout(() => {
      if (!userId) {
        odveziKorisnika();
        pokreniAnalitiku(null);
        return;
      }
      pokreniAnalitiku(userId);
      poveziKorisnika(userId);
    }, 0);
    return () => clearTimeout(t);
  }, [isLoaded, userId]);

  return null;
}

/**
 * Ono što o nalogu zna samo server: je li admin, koji plan i koje stanje
 * pristupa. Admin se ne meri; svi ostali nose plan i stanje kao svojstva osobe.
 */
export function useAnalitikaNaloga(nalog: { admin: boolean; plan?: string; stanje?: string }): void {
  const { admin, plan, stanje } = nalog;

  useEffect(() => {
    if (admin) iskljuciAnalitiku();
    else if (plan && stanje) opisiKorisnika({ plan, stanje });
  }, [admin, plan, stanje]);
}
