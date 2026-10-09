import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

// This script has no remote/project-link path. It only accepts the CLI's local stack.
const cli =
  process.platform === "win32"
    ? "node_modules/supabase/bin/supabase.exe"
    : "node_modules/supabase/bin/supabase";
const output = execFileSync(resolve(cli), ["status", "-o", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const env = Object.fromEntries(
  output
    .split("\n")
    .filter((l) => /^[A-Z_]+="/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^"|"$/g, ""),
      ];
    }),
);
if (env.API_URL !== "http://127.0.0.1:54321")
  throw new Error("Refusing non-local Supabase URL");
if (!env.ANON_KEY || !env.SERVICE_ROLE_KEY)
  throw new Error("Missing local keys");
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_BlockHunt",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  {
    input:
      "begin;\n" +
      readFileSync("supabase/schema.sql", "utf8") +
      "\n" +
      readFileSync("supabase/event.sql", "utf8") +
      "\ncommit;\nNOTIFY pgrst, 'reload schema';",
    stdio: ["pipe", "ignore", "pipe"],
  },
);
// Existing production config must never be replaced by the test setup.
let secret = randomBytes(32).toString("hex");
try {
  const old = readFileSync(".env.local", "utf8");
  if (!old.includes("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"))
    throw new Error("Refusing to overwrite a non-local .env.local");
  secret = old.match(/^EVENT_SECRET=(.+)$/m)?.[1] ?? secret;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
writeFileSync(
  ".env.local",
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${env.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}\nEVENT_SECRET=${secret}\n`,
);
console.log(
  "Applied schema and event functions to isolated local Supabase; wrote local-only .env.local (keys hidden).",
);
