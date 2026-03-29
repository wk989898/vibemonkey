import { execSync } from "child_process";
import path from "path";

export const isProd = process.env.NODE_ENV === "production";

export function exec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    // ignore
  }
}

export const alias = {
  "@": path.resolve("src"),
};

export const extensions = [".ts", ".tsx", ".mjs", ".js", ".jsx", ".vue"];
