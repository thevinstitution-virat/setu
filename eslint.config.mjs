import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Our client pages load data with `useEffect(() => { load(); }, [])`, where
    // load() is async and sets state only after a fetch resolves. The rule
    // can't see that and flags it; keep it visible as a warning until these
    // screens move to server components / a data hook (Phase 0b follow-up).
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "storage/**",
  ]),
]);

export default eslintConfig;
