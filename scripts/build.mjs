import { existsSync, promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build as viteBuild } from "vite";
import vue from "@vitejs/plugin-vue";
import chokidar from "chokidar";
import spawn from "cross-spawn";
import { createSvgIconsPlugin } from "vite-plugin-svg-icons";
import { analyzer } from "vite-bundle-analyzer";
import Icons from "unplugin-icons/vite";
import Sharp from "sharp";
import Vinyl from "vinyl";
import pkg from "../package.json" with { type: "json" };
import * as i18n from "./i18n.mjs";
import { alias, extensions } from "./common.mjs";
import { configLoader } from "./config-helper.mjs";
import { buildManifest } from "./manifest-helper.mjs";
import { getVersion, isBeta } from "./version-helper.mjs";
import { getCodeMirrorThemes, readGlobalsFile } from "./webpack-util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const DIST = path.join(DIST_ROOT, getBuildTargetDir());
const SRC = path.join(ROOT, "src");
const ICONS_DIR = path.join(SRC, "resources", "svg");
const isProd = process.env.NODE_ENV === "production";
const isAnalyze = process.env.RUN_ENV === "analyze";
const INIT_FUNC_NAME = "**VMInitInjection**";
const PAGE_MODE_HANDSHAKE = "PAGE_MODE_HANDSHAKE";
const VAULT_ID = "VAULT_ID";
const VM_VER = getVersion();
const pages = ["confirm", "options", "popup"];
const templateExts = new Set([".js", ".ts", ".tsx", ".html", ".json", ".yml", ".vue"]);
const entryExts = [".ts", ".js"];
const targetDirs = new Set(["firefox-mv2", "chrome-mv3", "selfHosted"]);
const legacyDistEntries = new Set([
  "_locales",
  "background",
  "confirm",
  "injected.js",
  "injected-web.js",
  "manifest.json",
  "options",
  "popup",
  "public",
]);
const bundleConfigs = [
  {
    name: "background",
    entry: resolveSourceEntry("background", "index"),
    output: "background/index.js",
    format: "iife",
    globalsGroup: "common",
  },
  ...pages.map((name) => ({
    name,
    entry: resolveSourceEntry(name, "index"),
    output: `${name}/index.js`,
    css: `${name}/index.css`,
    format: "iife",
    globalsGroup: "common",
    html: `${name}/index.html`,
  })),
  {
    name: "injected",
    entry: resolveSourceEntry("injected", "index"),
    output: "injected.js",
    format: "iife",
    globalsGroup: "injected/content",
    injectedEnv: "content",
  },
  {
    name: "injected-web",
    entry: resolveSourceEntry("injected", "web", "index"),
    output: "injected-web.js",
    format: "cjs",
    globalsGroup: "injected/web",
    injectedEnv: "web",
  },
];

configLoader
  .add({
    DEBUG: false,
  })
  .envFile()
  .env()
  .add({
    VM_VER,
  });

const defsObj = {
  ...pickEnvs([
    "DEBUG",
    "VM_VER",
    "SYNC_GOOGLE_DESKTOP_ID",
    "SYNC_GOOGLE_DESKTOP_SECRET",
    "SYNC_ONEDRIVE_CLIENT_ID",
    "SYNC_DROPBOX_CLIENT_ID",
  ]),
  "process.env.INIT_FUNC_NAME": JSON.stringify(INIT_FUNC_NAME),
  "process.env.CODEMIRROR_THEMES": JSON.stringify(getCodeMirrorThemes()),
  "process.env.DEV": JSON.stringify(!isProd),
  "process.env.TEST": "false",
};
const defsRe = new RegExp(`\\b(${Object.keys(defsObj).join("|").replace(/\./g, "\\.")})\\b`, "g");

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2] || "build";
  if (command === "dev") {
    await runDev();
    return;
  }
  if (command === "build") {
    await runBuild();
    return;
  }
  if (command === "manifest") {
    await writeManifest();
    return;
  }
  if (command === "i18n") {
    await updateI18n();
    return;
  }
  if (command === "copyI18n") {
    await copyI18n();
    return;
  }
  if (command === "check") {
    await checkI18n();
    return;
  }
  if (command === "bump") {
    await bump();
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function resolveSourceEntry(...segments) {
  const base = path.join(SRC, ...segments);
  const entry = entryExts.find((ext) => existsSync(base + ext));
  if (!entry) {
    throw new Error(`Unable to find source entry for ${base}`);
  }
  return base + entry;
}

function getBuildTargetDir() {
  const { TARGET } = process.env;
  if (TARGET === "chrome-mv3") {
    return TARGET;
  }
  if (TARGET === "selfHosted") {
    return TARGET;
  }
  return "firefox-mv2";
}

async function runBuild() {
  await clean();
  await pack();
  for (const config of bundleConfigs) {
    await viteBuild(createBundleConfig(config));
  }
  await writeManifest();
}

async function runDev() {
  await pack();
  await writeManifest();
  await Promise.all(
    bundleConfigs.map((config) => viteBuild(createBundleConfig(config, { watch: true }))),
  );
  const runCopyI18n = createQueue(copyI18n);
  const runManifest = createQueue(writeManifest);
  chokidar
    .watch(path.join(SRC, "_locales", "**/*"), {
      ignoreInitial: true,
    })
    .on("all", runCopyI18n);
  chokidar
    .watch(path.join(SRC, "**/*.{js,ts,tsx,html,json,yml,vue}"), {
      ignoreInitial: true,
      ignored: (file) => file.startsWith(path.join(SRC, "_locales")),
    })
    .on("all", runCopyI18n);
  chokidar
    .watch(path.join(SRC, "manifest.yml"), {
      ignoreInitial: true,
    })
    .on("all", runManifest);
}

function createBundleConfig(config, { watch = false } = {}) {
  const { name, entry, output, css, format, globalsGroup, injectedEnv, html } = config;
  const isInjected = Boolean(injectedEnv);
  const plugins = [
    vue({
      template: {
        transformAssetUrls: {
          includeAbsolute: false,
        },
        compilerOptions: {
          whitespace: "condense",
        },
      },
    }),
    createSvgIconsPlugin({
      iconDirs: [ICONS_DIR],
      symbolId: "[name]",
    }),
    Icons({
      compiler: "vue3",
    }),
    createWrapPlugin({
      name,
      globalsGroup,
      format,
    }),
    ...(html
      ? [
          createHtmlPlugin({
            html,
            js: output,
            css,
          }),
        ]
      : []),
    ...getAnalyzePlugins(name),
  ];
  return {
    configFile: false,
    envFile: false,
    publicDir: false,
    define: {
      ...defsObj,
      "process.env.IS_INJECTED": JSON.stringify(injectedEnv || false),
    },
    resolve: {
      alias,
      extensions,
    },
    plugins,
    build: {
      outDir: DIST,
      emptyOutDir: false,
      copyPublicDir: false,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 600,
      minify: isProd,
      modulePreload: false,
      reportCompressedSize: false,
      sourcemap: isAnalyze ? true : isProd ? false : "inline",
      target: isInjected ? "es2018" : "es2020",
      ...(watch ? { watch: {} } : {}),
      rolldownOptions: {
        input: entry,
        output: {
          codeSplitting: false,
          entryFileNames: output,
          assetFileNames: (assetInfo) =>
            css && assetInfo.name?.endsWith(".css") ? css : "assets/[name][extname]",
          format,
        },
      },
    },
  };
}

function createWrapPlugin({ name, globalsGroup, format }) {
  const watchFiles = getGlobalsFiles(globalsGroup);
  return {
    name: `vibemonkey-wrap-${name}`,
    buildStart() {
      watchFiles.forEach((file) => this.addWatchFile(file));
    },
    renderChunk(code, chunk) {
      if (!chunk.isEntry) return null;
      const globals = readGlobals(globalsGroup);
      if (globalsGroup === "common") {
        return {
          code: `{\n${globals}\n${code}\n}\n`,
          map: null,
        };
      }
      const header = `{
  const INIT_FUNC_NAME = '${INIT_FUNC_NAME}';
  if (window[INIT_FUNC_NAME] !== 1) {
`;
      if (globalsGroup === "injected/content") {
        return {
          code: `${header}${globals}\n${code}\n  }\n}\n`,
          map: null,
        };
      }
      if (globalsGroup === "injected/web") {
        if (format !== "cjs") {
          throw new Error("Injected web wrapper expects CommonJS output.");
        }
        return {
          code: `{
  const INIT_FUNC_NAME = '${INIT_FUNC_NAME}';
  if (window[INIT_FUNC_NAME] !== 1) {
    window[INIT_FUNC_NAME] = function (IS_FIREFOX, ${PAGE_MODE_HANDSHAKE}, ${VAULT_ID}) {
      const module = { __proto__: null, exports: {} };
      const exports = module.exports;
${indent(globals, 3)}
      (function () {
${indent(code, 4)}
      })();
      const exported = module.exports || exports;
      return exported && exported.__esModule ? exported.default : exported;
    };
  }
}
0;
`,
          map: null,
        };
      }
      throw new Error(`Unknown globals group: ${globalsGroup}`);
    },
  };
}

function createHtmlPlugin({ html, js, css }) {
  const title = "VibeMonkey";
  return {
    name: `vibemonkey-html-${html}`,
    async writeBundle() {
      const parts = [
        "<!DOCTYPE html>",
        '<meta charset="utf-8">',
        `<title>${title}</title>`,
        '<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1">',
      ];
      if (css) {
        parts.push(`<link href="/${css}" rel="stylesheet">`);
      }
      parts.push("<body>");
      parts.push(`<script src="/${js}"></script>`);
      await writeFile(path.join(DIST, html), parts.join(""));
    },
  };
}

function getAnalyzePlugins(name) {
  if (!isAnalyze) {
    return [];
  }
  return [
    analyzer({
      analyzerMode: "static",
      fileName: path.join(DIST, `stats-${name}`),
      reportTitle: `VibeMonkey Bundle Analyzer: ${name}`,
      openAnalyzer: false,
    }),
  ];
}

function pickEnvs(items) {
  return Object.assign(
    {},
    ...items.map((key) => ({
      [`process.env.${key}`]: JSON.stringify(configLoader.get(key)),
    })),
  );
}

function getGlobalsFiles(name) {
  if (name === "common") {
    return [
      path.join(SRC, "common", "safe-globals-shared"),
      path.join(SRC, "common", "safe-globals"),
    ];
  }
  if (name === "injected/content") {
    return [
      path.join(SRC, "common", "safe-globals-shared"),
      path.join(SRC, "injected", "safe-globals"),
      path.join(SRC, "injected", "content", "safe-globals"),
    ];
  }
  if (name === "injected/web") {
    return [
      path.join(SRC, "common", "safe-globals-shared"),
      path.join(SRC, "injected", "safe-globals"),
      path.join(SRC, "injected", "web", "safe-globals"),
    ];
  }
  throw new Error(`Unknown globals group: ${name}`);
}

function readGlobals(name) {
  return getGlobalsFiles(name)
    .map((file) => readGlobalsFile(file).replace(defsRe, (token) => defsObj[token]))
    .join("\n");
}

async function pack() {
  await Promise.all([createIcons(), copyI18n(), copyZip()]);
}

async function clean() {
  await fs.rm(DIST, { recursive: true, force: true });
  await cleanLegacyRootDist();
}

async function cleanLegacyRootDist() {
  const entries = await fs.readdir(DIST_ROOT, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          !targetDirs.has(entry.name) &&
          (legacyDistEntries.has(entry.name) || entry.name.startsWith("stats-")),
      )
      .map((entry) => fs.rm(path.join(DIST_ROOT, entry.name), { recursive: true, force: true })),
  );
}

async function writeManifest() {
  const manifest = await buildManifest();
  if (manifest.manifest_version === 3) {
    manifest.background = {
      ...manifest.background,
      service_worker: "background/index.js",
    };
  } else {
    manifest.background = {
      ...manifest.background,
      scripts: ["background/index.js"],
    };
  }
  await writeFile(path.join(DIST, "manifest.json"), JSON.stringify(manifest));
}

async function createIcons() {
  const alpha = 0.5;
  const dist = path.join(DIST, "public", "images");
  await fs.mkdir(dist, { recursive: true });
  const icon = Sharp(path.join(SRC, "resources", `icon${isBeta() ? "-beta" : ""}.png`));
  const gray = icon.clone().grayscale();
  const transparent = icon.clone().composite([
    {
      input: Buffer.from([255, 255, 255, 256 * alpha]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: "dest-in",
    },
  ]);
  const types = [
    ["", icon],
    ["b", gray],
    ["w", transparent],
  ];
  const handle = (size, type = "", image = icon) => {
    let res = image.clone().resize({ width: size });
    if (size < 48) res = res.sharpen(size < 32 ? 0.5 : 0.25);
    return res.toFile(path.join(dist, `icon${size}${type}.png`));
  };
  const darkenOuterEdge = async (img) =>
    img.composite([
      {
        input: await img.toBuffer(),
        blend: "over",
      },
    ]);
  const handle16 = async ([type, image]) => {
    const res = image
      .clone()
      .resize({ width: 18 })
      .sharpen(0.5, 0)
      .extract({ left: 1, top: 2, width: 16, height: 16 });
    return (type === "w" ? res : await darkenOuterEdge(res)).toFile(
      path.join(dist, `icon16${type}.png`),
    );
  };
  await Promise.all([
    handle(128),
    ...types.map(handle16),
    ...[32, 38, 48, 64].flatMap((size) => types.map((type) => handle(size, ...type))),
  ]);
}

async function copyZip() {
  await Promise.all([
    copyFile(
      path.join(ROOT, "node_modules", "@zip.js", "zip.js", "dist", "zip-no-worker.min.js"),
      path.join(DIST, "public", "lib", "zip-no-worker.min.js"),
    ),
    copyFile(
      path.join(ROOT, "node_modules", "@zip.js", "zip.js", "dist", "z-worker.js"),
      path.join(DIST, "public", "lib", "z-worker.js"),
    ),
  ]);
}

async function copyI18n() {
  const stream = i18n.read({
    base: path.join(SRC, "_locales"),
    touchedOnly: true,
    useDefaultLang: true,
    markUntouched: false,
    extension: ".json",
    stripDescriptions: true,
  });
  const files = await readStreamFiles(stream);
  await writeVinylFiles(files, path.join(DIST, "_locales"));
}

async function checkI18n() {
  await readStreamFiles(
    i18n.read({
      base: path.join(SRC, "_locales"),
      extension: ".json",
    }),
  );
}

async function updateI18n() {
  const stream = i18n.extract({
    base: path.join(SRC, "_locales"),
    manifest: path.join(SRC, "manifest.yml"),
    touchedOnly: false,
    useDefaultLang: false,
    markUntouched: true,
    extension: ".yml",
  });
  for (const file of await walk(SRC)) {
    if (!templateExts.has(path.extname(file))) continue;
    stream.write(
      new Vinyl({
        path: file,
        contents: await fs.readFile(file),
      }),
    );
  }
  stream.end();
  const files = await readStreamFiles(stream);
  await writeVinylFiles(files, path.join(SRC, "_locales"));
}

async function bump() {
  if (process.argv.includes("--reset")) {
    delete pkg.beta;
  } else {
    pkg.beta = (+pkg.beta || 0) + 1;
  }
  await writeFile(path.join(ROOT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  if (process.argv.includes("--commit")) {
    const version = `v${getVersion()}`;
    spawn.sync("git", ["commit", "-am", version], { stdio: "inherit" });
    spawn.sync("git", ["tag", "-m", version, version], { stdio: "inherit" });
  }
}

async function readStreamFiles(stream) {
  return new Promise((resolve, reject) => {
    const files = [];
    stream.on("data", (file) => files.push(file));
    stream.on("error", reject);
    stream.on("end", () => resolve(files));
  });
}

async function writeVinylFiles(files, baseDir) {
  await Promise.all(
    files.map(async (file) => {
      await writeFile(path.join(baseDir, file.path), file.contents);
    }),
  );
}

async function copyFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

async function writeFile(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(file)));
    } else {
      files.push(file);
    }
  }
  return files;
}

function createQueue(task) {
  let queue = Promise.resolve();
  return (...args) => {
    queue = queue
      .catch(() => {})
      .then(() => task(...args))
      .catch((err) => {
        console.error(err);
      });
    return queue;
  };
}

function indent(text, level) {
  const prefix = "  ".repeat(level);
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}
