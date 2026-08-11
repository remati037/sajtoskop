// apps/web/src/app/prijava/[[...rest]]/page.tsx
// Prijava je preseljena na početnu stranu (`/`), gde stoji zajedno sa
// registracijom i prekidačem između njih.
//
// Ruta ostaje kao redirekcija zbog starih linkova — u mejlovima, u bukmarkovima
// i u svakom `redirect("/prijava")` koji bi se slučajno vratio u kod.
// `[[...rest]]` se zadržava da i zaostali koraci starog toka
// (`/prijava/factor-one`, `/prijava/sso-callback`) završe na formi, a ne na 404.

import { redirect } from "next/navigation";

export default function Page() {
  redirect("/");
}
