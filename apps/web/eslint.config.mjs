// apps/web/eslint.config.mjs — flat config (Next 15, Faza 7, 7.3).
// eslint-config-next@15 izvozi legacy konfiguracije; FlatCompat ih prevodi u flat.
// Pokretanje: pnpm --filter web lint  (ili `pnpm lint` iz korena).
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    rules: {
      // [Faza 7, 7.3] Pravilo je pisano za engleski apostrof; srpski kopi
      // koristi navodnike „…" u JSX tekstu svuda. Isključeno svesno — HTML
      // entiteti u tekstu bi bili čitljiviji stroju nego čoveku.
      "react/no-unescaped-entities": "off",
    },
  },
];

export default eslintConfig;
