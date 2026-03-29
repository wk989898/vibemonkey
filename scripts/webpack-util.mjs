import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseSync } from "oxc-parser";
import ts from "typescript";

export const entryGlobals = {
  common: [],
  "injected/content": [],
  "injected/web": [],
};

const sourceExts = [".ts", ".js"];
const transpileOptions = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    removeComments: false,
  },
  reportDiagnostics: true,
};

const resolveSourcePath = (basePath) => {
  const resolved = sourceExts.map((ext) => `${basePath}${ext}`).find((file) => existsSync(file));
  if (!resolved) {
    throw new Error(`Unable to find source file for ${basePath}`);
  }
  return resolved;
};

export const entryPathToFilename = (filePath) =>
  path.isAbsolute(filePath)
    ? resolveSourcePath(filePath)
    : filePath === "*"
      ? resolveSourcePath(path.resolve("src/common/safe-globals-shared"))
      : resolveSourcePath(path.resolve(`src/${filePath}/safe-globals`));

Object.entries(entryGlobals).forEach(([name, val]) => {
  const parts = name.split("/");
  if (parts[1]) parts[1] = name;
  val.push("*", ...parts);
});

export function getCodeMirrorThemes() {
  const name = "neo.css";
  const themePath = fileURLToPath(import.meta.resolve(`codemirror/theme/${name}`));
  return readdirSync(path.dirname(themePath), { withFileTypes: true })
    .map((entry) => entry.isFile() && entry.name.endsWith(".css") && entry.name.slice(0, -4))
    .filter(Boolean);
}

export function readGlobalsFile(filePath, { ast = false } = {}) {
  const filename = entryPathToFilename(filePath);
  const source = readFileSync(filename, { encoding: "utf8" });
  const result = ts.transpileModule(source, {
    ...transpileOptions,
    fileName: filename,
  });
  if (result.diagnostics?.length) {
    const diagnostic = result.diagnostics[0];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file || diagnostic.start == null) {
      throw new Error(`${filename}: ${message}`);
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    throw new Error(`${filename}:${line + 1}:${character + 1}: ${message}`);
  }
  const src = result.outputText.replace(/\bexport\s+(?=(const|let|var|function)\s)/g, "");
  if (!ast) {
    return src;
  }
  const res = parseSync(filename, src, { sourceType: "module" });
  if (res.errors.length) {
    const error = res.errors[0];
    throw new Error(`${filename}: ${error.message}`);
  }
  return {
    ast: {
      program: res.program,
    },
  };
}
