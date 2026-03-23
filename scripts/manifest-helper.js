const fs = require('fs').promises;
const yaml = require('js-yaml');
const { getVersion, isBeta } = require('./version-helper');
const CHROME_MV3_TARGET = 'chrome-mv3';

async function readManifest() {
  const input = await fs.readFile('src/manifest.yml', 'utf8');
  const data = yaml.load(input);
  return data;
}

function isChromeMv3() {
  return process.env.TARGET === CHROME_MV3_TARGET;
}

function isHostPermission(permission) {
  return permission === '<all_urls>'
    || /^(\*|http|https|file|ftp|ws|wss):/.test(permission);
}

function convertToChromeMv3(base) {
  const data = { ...base };
  const action = data.action || data.browser_action;
  const permissions = [];
  const hostPermissions = [];
  if (action) {
    data.action = { ...action };
    delete data.action.browser_style;
  }
  delete data.browser_action;
  for (const permission of data.permissions || []) {
    if (permission === 'webRequestBlocking') continue;
    if (isHostPermission(permission)) {
      hostPermissions.push(permission);
    } else {
      permissions.push(permission);
    }
  }
  if (!permissions.includes('scripting')) {
    permissions.push('scripting');
  }
  if (!permissions.includes('declarativeNetRequestWithHostAccess')) {
    permissions.push('declarativeNetRequestWithHostAccess');
  }
  data.permissions = permissions;
  if (hostPermissions.length) {
    data.host_permissions = [...new Set([
      ...(data.host_permissions || []),
      ...hostPermissions,
    ])];
  }
  data.background = {
    service_worker: data.background?.service_worker || 'background/index.js',
  };
  data.commands = { ...(data.commands || {}) };
  if (data.commands._execute_browser_action) {
    data.commands._execute_action = data.commands._execute_browser_action;
    delete data.commands._execute_browser_action;
  }
  data.manifest_version = 3;
  data.minimum_chrome_version = '88.0';
  delete data.browser_specific_settings;
  return data;
}

async function buildManifest(base) {
  let data = base ? { ...base } : await readManifest();
  if (isChromeMv3()) {
    data = convertToChromeMv3(data);
  }
  data.version = getVersion();
  if (process.env.TARGET === 'selfHosted') {
    data.browser_specific_settings.gecko.update_url = 'https://raw.githubusercontent.com/violentmonkey/violentmonkey/updates/updates.json';
  }
  if (isBeta()) {
    // Do not support i18n in beta version
    const name = 'Violentmonkey BETA';
    data.name = name;
    (data.action || data.browser_action).default_title = name;
  }
  return data;
}

async function buildUpdatesList(version, url) {
  const manifest = await readManifest();
  const data = {
    addons: {
      [manifest.browser_specific_settings.gecko.id]: {
        updates: [
          {
            version,
            update_link: url,
          },
        ],
      },
    },
  };
  return data;
}

class ListBackgroundScriptsPlugin {
  constructor({ minify } = {}) {
    this.minify = minify;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise(this.constructor.name, async compilation => {
      const dist = compilation.outputOptions.path;
      const path = `${dist}/manifest.json`;
      const manifest = await buildManifest();
      const bgId = 'background/index';
      const bgEntry = compilation.entrypoints.get(bgId);
      const files = bgEntry.getFiles();
      if (isChromeMv3()) {
        const workers = files.filter(file => file.endsWith('.js'));
        if (workers.length !== 1) {
          throw new Error(`Chrome MV3 background service worker must be a single JS file, got: ${workers.join(', ')}`);
        }
        if (manifest.background.service_worker === workers[0]) {
          return;
        }
        manifest.background.service_worker = workers[0];
      } else {
        const scripts = [...files];
        if (`${manifest.background.scripts}` === `${scripts}`) {
          return;
        }
        manifest.background.scripts = scripts;
      }
      await fs.writeFile(path,
        JSON.stringify(manifest, null, this.minify ? 0 : 2),
        { encoding: 'utf8' });
    });
  }
}

exports.readManifest = readManifest;
exports.buildManifest = buildManifest;
exports.buildUpdatesList = buildUpdatesList;
exports.ListBackgroundScriptsPlugin = ListBackgroundScriptsPlugin;
