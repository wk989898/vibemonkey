import { spawnSync } from "child_process";

const result = spawnSync("oxlint", ["-c", ".oxlintrc.json", "."], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status) {
  process.exit(result.status);
}
