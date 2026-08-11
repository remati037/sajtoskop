// apps/web/src/app/registracija/[[...rest]]/page.tsx
// Isto kao `prijava/[[...rest]]/page.tsx` — forma je na `/`, ovde je samo
// redirekcija. Parametar otvara karticu „Registracija", pa stari link i dalje
// vodi tačno tamo gde je vodio.

import { redirect } from "next/navigation";

export default function Page() {
  redirect("/?nalog=nov");
}
