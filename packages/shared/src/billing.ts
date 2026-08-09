// packages/shared/src/billing.ts
// Granica ka naplati. U beti iza nje ne stoji ništa — i to je poenta.
//
// F4 §6: „Ne piši Lemon Squeezy ni IPS QR sada. Poenta interfejsa je da kasnija
// integracija bude jedan fajl, a ne da se sada nešto integriše."
//
// Pravilo: aplikacija zove `billingProvider()`, nikad konkretnu klasu. Kad
// naplata stigne, menja se telo te jedne funkcije i ništa drugo. Ako se ikad
// zatekne `new FreeBetaProvider()` u nekoj ruti ili komponenti, interfejs je
// izgubio smisao.

/** Zašto je poziv odbijen. Postoji da UI ume da razlikuje „još ne" od „greška". */
export class NotImplementedError extends Error {
  readonly code = "not_implemented";

  constructor(operacija: string) {
    super(`${operacija} ne postoji u beti. Beta je besplatna dok traje.`);
    this.name = "NotImplementedError";
  }
}

export interface BillingProvider {
  checkoutUrl(plan: string, userId: string): Promise<string>;
  cancelSubscription(subId: string): Promise<void>;
  portalUrl(subId: string): Promise<string>;
}

/**
 * Jedina implementacija u beti. Baca na svemu — namerno.
 *
 * Tiho vraćanje `null` ili prazne putanje bi značilo da se zaboravljen poziv
 * naplate otkrije tek kad korisnik klikne dugme koje ne radi.
 */
export class FreeBetaProvider implements BillingProvider {
  async checkoutUrl(): Promise<string> {
    throw new NotImplementedError("Plaćanje");
  }

  async cancelSubscription(): Promise<void> {
    throw new NotImplementedError("Otkazivanje pretplate");
  }

  async portalUrl(): Promise<string> {
    throw new NotImplementedError("Korisnički portal za naplatu");
  }
}

const provider: BillingProvider = new FreeBetaProvider();

/** Jedini način da se dođe do provajdera. Vidi pravilo na vrhu fajla. */
export function billingProvider(): BillingProvider {
  return provider;
}
