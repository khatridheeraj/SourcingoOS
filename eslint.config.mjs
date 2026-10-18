import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Runs on Supabase (Deno), checked with deno check.
    "supabase/functions/**",
    // MarkerPilot: a built page and its plain-browser shim (see markerpilot/build-page.cjs).
    "markerpilot/**",
    "public/markerpilot/**",
  ]),
]);

export default eslintConfig;
