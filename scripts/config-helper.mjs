import { readFileSync } from "fs";

export class ConfigLoader {
  data = {};

  add(values) {
    Object.assign(this.data, values);
    return this;
  }

  env() {
    return this.add(process.env);
  }

  envFile(filepath = ".env") {
    let content = "";
    try {
      content = readFileSync(filepath, "utf8");
    } catch {
      // ignore error
    }
    const values = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        if (i < 0) return [];
        const key = line.slice(0, i).trim();
        let value = line.slice(i + 1).trim();
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
        return [key, value];
      })
      .reduce((prev, [key, value]) => {
        if (key) prev[key] = value;
        return prev;
      }, {});
    return this.add(values);
  }

  get(key, def) {
    return this.data[key] ?? def;
  }
}

export const configLoader = new ConfigLoader();
