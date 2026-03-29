import { spawnSync } from "child_process";

const args = process.argv
  .slice(2)
  .flatMap((arg) => (arg === "--runInBand" ? ["--no-file-parallelism"] : [arg]));
const result = spawnSync("vitest", ["run", ...args], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status) {
  process.exit(result.status);
}
