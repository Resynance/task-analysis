#!/usr/bin/env node
/**
 * Lightweight pre-push guard before `git push`.
 *
 * 1) **Path denylist** — fails if git-tracked paths look like local datasets, secrets, build
 * artifacts, or trace-export audit `reports/` trees that should stay out of the remote.
 * 2) **Heuristic secret scan** — regex over tracked `.ts/.tsx/.js/.json/.md/.yml` for obvious API
 * key / token shapes (expect false positives; review manually).
 *
 * Run from repo root: `node tooling/check-push-data.mjs` or `npm run check:push-data`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** Best-effort: read `TASK_ANALYSIS_*` from `.env` so `npm run check:push-data` matches Next without manual `export`. */
function loadTaskAnalysisEnvFromDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^TASK_ANALYSIS_[A-Z0-9_]+=(.*)$/);
    if (!m) continue;
    const key = t.slice(0, t.indexOf("="));
    let val = m[1].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadTaskAnalysisEnvFromDotEnv();

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gitLsFiles() {
  return execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

const tracked = gitLsFiles();
const files = tracked ? tracked.split("\n") : [];

const denyPatterns = [
  {
    re: /^prompts\/(?!\.gitkeep$).*$/,
    msg: "prompts/ dataset (gitignored — only prompts/.gitkeep may be tracked)",
  },
  {
    re: /^Prompts\/(?!\.gitkeep$).*$/,
    msg: "Prompts/ dataset (gitignored — only Prompts/.gitkeep may be tracked)",
  },
  { re: /^\.env$/i, msg: ".env (secrets)" },
  { re: /\.db$/i, msg: "SQLite database" },
  { re: /\.(pem|p12|pfx)$/i, msg: "Key material" },
  {
    re: /^projects\/(?!\.gitkeep$).*$/,
    msg: "projects/ (gitignored — local only)",
  },
  { re: /\.har$/i, msg: "HAR capture" },
  { re: /^node_modules\//, msg: "node_modules" },
  { re: /^\.next\//, msg: ".next build" },
  { re: /^generated\//, msg: "Prisma generated client" },
  { re: /^scripts\//, msg: "scripts/ (gitignored — local only)" },
  { re: /^all_prompt_status\//, msg: "all_prompt_status/ (gitignored — local only)" },
  { re: /^all-prompts-status\//, msg: "all-prompts-status/ (gitignored — local only)" },
  { re: /^scenarios\/fos-code\.json$/i, msg: "scenarios/fos-code.json (gitignored)" },
];

for (const key of ["TASK_ANALYSIS_TRACE_EXPORTS_DIR", "TASK_ANALYSIS_PM_FAILURE_DIR"]) {
  const raw = process.env[key]?.trim().replace(/\\/g, "/");
  if (!raw || raw.includes("..") || raw.startsWith("/")) continue;
  denyPatterns.push({
    re: new RegExp(`^${escapeRegExp(raw)}/`),
    msg: `Tracked under custom ${key}`,
  });
}

const hits = [];
for (const f of files) {
  for (const { re, msg } of denyPatterns) {
    if (re.test(f)) hits.push({ f, msg });
  }
}

console.log(`Tracked files: ${files.length}`);
if (hits.length) {
  console.log("\n⚠️ TRACKED FILES THAT SHOULD NOT BE PUSHED:\n");
  for (const h of hits) console.log(` - ${h.f} (${h.msg})`);
  console.log("\nFix: git rm --cached then commit.\n");
  process.exit(2);
}

const keyRe =
  /(sk-ant-|sk_live|sk-[a-zA-Z0-9]{20,}|xox[baprs]-|ghp_[a-zA-Z0-9]{36}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
const keyHits = [];
for (const f of files) {
  if (!/\.(ts|tsx|js|json|md|yml|yaml)$/.test(f)) continue;
  if (f.includes("node_modules") || f.includes(".next")) continue;
  const abs = path.join(root, f);
  const body = fs.readFileSync(abs, "utf8");
  if (keyRe.test(body)) keyHits.push(f);
}
if (keyHits.length) {
  console.log("\n⚠️ Possible secret-like literals in tracked text files:\n");
  for (const f of keyHits) console.log(` - ${f}`);
  console.log("\nReview manually (may include false positives).\n");
  process.exit(3);
}

console.log("\n✓ No deny-listed tracked paths.");
console.log("✓ No obvious secret patterns in scanned tracked sources.");
console.log("\nSee .gitignore for local-only paths (.env, *.db, prompts/, reports/, …).\n");
