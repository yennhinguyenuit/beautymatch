import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("beautymatch/public/js")
  .filter((file) => /\.(?:m?js)$/.test(file))
  .map((file) => `beautymatch/public/js/${file}`);
files.push(
  "scripts/preview_frontend.mjs",
  "scripts/verify_live_frontend.mjs",
  "scripts/capture_botanical.mjs",
  "scripts/verify_crm_visual.mjs",
);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  `Syntax checked ${files.length} frontend and verification modules.`,
);
