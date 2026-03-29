import pkg from "../package.json" with { type: "json" };

export function getVersion() {
  return process.env.VERSION || `${pkg.version.match(/\d+\.\d+/)[0]}.${pkg.beta || 0}`;
}

export function isBeta() {
  return process.env.BETA || pkg.beta > 0;
}
