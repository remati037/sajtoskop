import { SignIn } from "@clerk/nextjs";

// `[[...rest]]` je obavezan: Clerk unutar sebe rutira na /prijava/factor-one,
// /prijava/sso-callback i slično. Bez catch-all segmenta ti koraci daju 404.

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
