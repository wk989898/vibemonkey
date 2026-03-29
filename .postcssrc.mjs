import path from "path";
import { fileURLToPath } from "url";
import autoprefixer from "autoprefixer";
import postcssCalc from "postcss-calc";
import postcssImport from "postcss-import";
import postcssNested from "postcss-nested";
import postcssSimpleVars from "postcss-simple-vars";
import { alias } from "./scripts/common.mjs";

const resolveFromRepo = (id) => fileURLToPath(import.meta.resolve(id));

export default {
  parser: "postcss-scss",
  plugins: [
    postcssSimpleVars(),
    // Transform @import, resolve `@` to `src`
    postcssImport({
      resolve(id) {
        if (id.startsWith("~")) {
          const parts = id.slice(1).split("/");
          parts[0] = alias[parts[0]] || parts[0];
          return resolveFromRepo(parts.join("/"));
        }
        return id;
      },
    }),
    // Calculate at compile time
    postcssCalc(),
    postcssNested(),
    autoprefixer(),
  ],
};
