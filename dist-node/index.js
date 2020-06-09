'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault(ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var chalk = _interopDefault(require('chalk'));
var path = _interopDefault(require('path'));
var yargs = _interopDefault(require('yargs-parser'));
var events = require('events');
var execa = _interopDefault(require('execa'));
var fs = require('fs');
var fs__default = _interopDefault(fs);
var glob = _interopDefault(require('glob'));
var mkdirp = _interopDefault(require('mkdirp'));
var npmRunPath = _interopDefault(require('npm-run-path'));
var rimraf = _interopDefault(require('rimraf'));
var cacache = _interopDefault(require('cacache'));
var globalCacheDir = _interopDefault(require('cachedir'));
var etag = _interopDefault(require('etag'));
var projectCacheDir = _interopDefault(require('find-cache-dir'));
var findUp = _interopDefault(require('find-up'));
var got = _interopDefault(require('got'));
var open = _interopDefault(require('open'));
var Core = _interopDefault(require('css-modules-loader-core'));
var esbuild = require('esbuild');
var rollupPluginAlias = _interopDefault(require('@rollup/plugin-alias'));
var rollupPluginCommonjs = _interopDefault(require('@rollup/plugin-commonjs'));
var rollupPluginJson = _interopDefault(require('@rollup/plugin-json'));
var rollupPluginNodeResolve = _interopDefault(require('@rollup/plugin-node-resolve'));
var rollupPluginReplace = _interopDefault(require('@rollup/plugin-replace'));
var isNodeBuiltin = _interopDefault(require('is-builtin-module'));
var ora = _interopDefault(require('ora'));
var rollup = require('rollup');
var validatePackageName = _interopDefault(require('validate-npm-package-name'));
var PQueue = _interopDefault(require('p-queue'));
var url = _interopDefault(require('url'));
var tar = _interopDefault(require('tar'));
var zlib = _interopDefault(require('zlib'));
var esModuleLexer = require('es-module-lexer');
var mime = _interopDefault(require('mime-types'));
var stripComments = _interopDefault(require('strip-comments'));
var readline = _interopDefault(require('readline'));
var util = _interopDefault(require('util'));
var chokidar = _interopDefault(require('chokidar'));
var isCompressible = _interopDefault(require('compressible'));
var detectPort = _interopDefault(require('detect-port'));
var http = _interopDefault(require('http'));
var HttpProxy = _interopDefault(require('http-proxy'));
var os = _interopDefault(require('os'));
var onProcessExit = _interopDefault(require('signal-exit'));
var stream = _interopDefault(require('stream'));
var WebSocket = _interopDefault(require('ws'));
var cosmiconfig = require('cosmiconfig');
var deepmerge = require('deepmerge');
var jsonschema = require('jsonschema');
var babel = require('@babel/core')
var traverse = require("@babel/traverse").default;
const {
  parse
} = require('es-module-lexer');

function spliceString(source, withSlice, start, end) {
  return source.slice(0, start) + (withSlice || '') + source.slice(end);
}

async function scanCodeImportsExports(code) {
  const [imports] = await parse(code);
  return imports.filter(imp => {
    //imp.d = -2 = import.meta.url = we can skip this for now
    if (imp.d === -2) {
      return false;
    } // imp.d > -1 === dynamic import


    if (imp.d > -1) {
      const importStatement = code.substring(imp.s, imp.e);
      const importSpecifierMatch = importStatement.match(/^\s*['"](.*)['"]\s*$/m);
      return !!importSpecifierMatch;
    }

    return true;
  });
}
async function transformEsmImports(_code, replaceImport) {
  const imports = await scanCodeImportsExports(_code);
  let rewrittenCode = _code;

  for (const imp of imports.reverse()) {
    let spec = rewrittenCode.substring(imp.s, imp.e);

    if (imp.d > -1) {
      const importSpecifierMatch = spec.match(/^\s*['"](.*)['"]\s*$/m);
      spec = importSpecifierMatch[1];
    }

    let rewrittenImport = replaceImport(spec);

    if (imp.d > -1) {
      rewrittenImport = JSON.stringify(rewrittenImport);
    }

    rewrittenCode = spliceString(rewrittenCode, rewrittenImport, imp.s, imp.e);
  }

  return rewrittenCode;
}

const PIKA_CDN = `https://cdn.pika.dev`;
const GLOBAL_CACHE_DIR = globalCacheDir('snowpack');
const RESOURCE_CACHE = path.join(GLOBAL_CACHE_DIR, 'pkg-cache-1.4');
const BUILD_CACHE = path.join(GLOBAL_CACHE_DIR, 'build-cache-1.4');
const PROJECT_CACHE_DIR = projectCacheDir({
  name: 'snowpack'
});
const DEV_DEPENDENCIES_DIR = path.join(PROJECT_CACHE_DIR, 'dev');
const BUILD_DEPENDENCIES_DIR = path.join(PROJECT_CACHE_DIR, 'build');
const LOCKFILE_HASH_FILE = '.hash';
const HAS_CDN_HASH_REGEX = /\-[a-zA-Z0-9]{16,}/;
function isYarn(cwd) {
  return fs__default.existsSync(path.join(cwd, 'yarn.lock'));
}
async function readLockfile(cwd) {
  try {
    var lockfileContents = fs__default.readFileSync(path.join(cwd, 'snowpack.lock.json'), {
      encoding: 'utf8'
    });
  } catch (err) {
    // no lockfile found, ignore and continue
    return null;
  } // If this fails, we actually do want to alert the user by throwing


  return JSON.parse(lockfileContents);
}
async function writeLockfile(loc, importMap) {
  const sortedImportMap = {
    imports: {}
  };

  for (const key of Object.keys(importMap.imports).sort()) {
    sortedImportMap.imports[key] = importMap.imports[key];
  }

  fs__default.writeFileSync(loc, JSON.stringify(sortedImportMap, undefined, 2), {
    encoding: 'utf8'
  });
}
function fetchCDNResource(resourceUrl, responseType) {
  if (!resourceUrl.startsWith(PIKA_CDN)) {
    resourceUrl = PIKA_CDN + resourceUrl;
  } // @ts-ignore - TS doesn't like responseType being unknown amount three options


  return got(resourceUrl, {
    responseType: responseType,
    headers: {
      'user-agent': `snowpack/v1.4 (https://snowpack.dev)`
    },
    throwHttpErrors: false
  });
}
function isTruthy(item) {
  return Boolean(item);
}
/**
 * Given a package name, look for that package's package.json manifest.
 * Return both the manifest location (if believed to exist) and the
 * manifest itself (if found).
 *
 * NOTE: You used to be able to require() a package.json file directly,
 * but now with export map support in Node v13 that's no longer possible.
 */

function resolveDependencyManifest(dep, cwd) {
  // Attempt #1: Resolve the dependency manifest normally. This works for most
  // packages, but fails when the package defines an export map that doesn't
  // include a package.json. If we detect that to be the reason for failure,
  // move on to our custom implementation.
  try {
    const depManifest = require.resolve(`${dep}/package.json`, {
      paths: [cwd]
    });

    return [depManifest, require(depManifest)];
  } catch (err) {
    // if its an export map issue, move on to our manual resolver.
    if (err.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      return [null, null];
    }
  } // Attempt #2: Resolve the dependency manifest manually. This involves resolving
  // the dep itself to find the entrypoint file, and then haphazardly replacing the
  // file path within the package with a "./package.json" instead. It's not as
  // thorough as Attempt #1, but it should work well until export maps become more
  // established & move out of experimental mode.


  let result = [null, null];

  try {
    const fullPath = require.resolve(dep, {
      paths: [cwd]
    }); // Strip everything after the package name to get the package root path
    // NOTE: This find-replace is very gross, replace with something like upath.


    const searchPath = `${path.sep}node_modules${path.sep}${dep.replace('/', path.sep)}`;
    const indexOfSearch = fullPath.lastIndexOf(searchPath);

    if (indexOfSearch >= 0) {
      const manifestPath = fullPath.substring(0, indexOfSearch + searchPath.length + 1) + 'package.json';
      result[0] = manifestPath;
      const manifestStr = fs__default.readFileSync(manifestPath, {
        encoding: 'utf8'
      });
      result[1] = JSON.parse(manifestStr);
    }
  } catch (err) {// ignore
  } finally {
    return result;
  }
}
/**
 * If Rollup erred parsing a particular file, show suggestions based on its
 * file extension (note: lowercase is fine).
 */

const MISSING_PLUGIN_SUGGESTIONS = {
  '.svelte': 'Try installing rollup-plugin-svelte and adding it to Snowpack (https://www.snowpack.dev/#custom-rollup-plugins)',
  '.vue': 'Try installing rollup-plugin-vue and adding it to Snowpack (https://www.snowpack.dev/#custom-rollup-plugins)'
};
const appNames = {
  win32: {
    brave: 'brave',
    chrome: 'chrome'
  },
  darwin: {
    brave: 'Brave Browser',
    chrome: 'Google Chrome'
  },
  linux: {
    brave: 'brave',
    chrome: 'google-chrome'
  }
};
async function openInBrowser(port, browser) {
  const url = `http://localhost:${port}`;
  browser = /chrome/i.test(browser) ? appNames[process.platform]['chrome'] : /brave/i.test(browser) ? appNames[process.platform]['brave'] : browser;

  if (process.platform === 'darwin' && /chrome|default/i.test(browser)) {
    // If we're on macOS, and we haven't requested a specific browser,
    // we can try opening Chrome with AppleScript. This lets us reuse an
    // existing tab when possible instead of creating a new one.
    try {
      await execa.command('ps cax | grep "Google Chrome"', {
        shell: true
      });
      await execa('osascript ../assets/openChrome.applescript "' + encodeURI(url) + '"', {
        cwd: __dirname,
        stdio: 'ignore',
        shell: true
      });
      return true;
    } catch (err) {
      // If macOS auto-reuse doesn't work, just open normally, using default browser.
      open(url);
    }
  } else {
    browser === 'default' ? open(url) : open(url, {
      app: browser
    });
  }
}
async function checkLockfileHash(dir) {
  const lockfileLoc = await findUp(['package-lock.json', 'yarn.lock']);

  if (!lockfileLoc) {
    return true;
  }

  const hashLoc = path.join(dir, LOCKFILE_HASH_FILE);
  const newLockHash = etag(await fs__default.promises.readFile(lockfileLoc, 'utf-8'));
  const oldLockHash = await fs__default.promises.readFile(hashLoc, 'utf-8').catch(() => '');
  return newLockHash === oldLockHash;
}
async function updateLockfileHash(dir) {
  const lockfileLoc = await findUp(['package-lock.json', 'yarn.lock']);

  if (!lockfileLoc) {
    return;
  }

  const hashLoc = path.join(dir, LOCKFILE_HASH_FILE);
  const newLockHash = etag(await fs__default.promises.readFile(lockfileLoc));
  await mkdirp(path.dirname(hashLoc));
  await fs__default.promises.writeFile(hashLoc, newLockHash);
}
async function clearCache() {
  return Promise.all([cacache.rm.all(RESOURCE_CACHE), cacache.rm.all(BUILD_CACHE), rimraf.sync(PROJECT_CACHE_DIR)]);
}
/**
 * Given an import string and a list of scripts, return the mount script that matches the import.
 *
 * `mount ./src --to /_dist_` and `mount src --to /_dist_` match `src/components/Button`
 * `mount src --to /_dist_` does not match `package/components/Button`
 */

function findMatchingMountScript(scripts, spec) {
  // Only match bare module specifiers. relative and absolute imports should not match
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || spec.startsWith('http://') || spec.startsWith('https://')) {
    return null;
  }

  return scripts.filter(script => script.type === 'mount').find(({
    args
  }) => spec.startsWith(args.fromDisk));
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);

  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function (sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }

  return keys;
}

function _objectSpread2(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};

    if (i % 2) {
      ownKeys(Object(source), true).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }

  return target;
}

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;

  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }

  return target;
}

function _objectWithoutProperties(source, excluded) {
  if (source == null) return {};

  var target = _objectWithoutPropertiesLoose(source, excluded);

  var key, i;

  if (Object.getOwnPropertySymbols) {
    var sourceSymbolKeys = Object.getOwnPropertySymbols(source);

    for (i = 0; i < sourceSymbolKeys.length; i++) {
      key = sourceSymbolKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
      target[key] = source[key];
    }
  }

  return target;
}

const IS_PREACT = /from\s+['"]preact['"]/;
function checkIsPreact(filePath, contents) {
  return filePath.endsWith('.jsx') && IS_PREACT.test(contents);
}
function isDirectoryImport(fileLoc, spec) {
  const importedFileOnDisk = path.resolve(path.dirname(fileLoc), spec);

  try {
    const stat = fs.statSync(importedFileOnDisk);
    return stat.isDirectory();
  } catch (err) {// file doesn't exist, that's fine
  }

  return false;
}
function wrapImportMeta(code, {
  hmr,
  env
}) {
  if (!code.includes('import.meta')) {
    return code;
  }

  return (hmr ? `import * as  __SNOWPACK_HMR__ from '/__snowpack__/hmr.js';\nimport.meta.hot = __SNOWPACK_HMR__.createHotContext(import.meta.url);\n` : ``) + (env ? `import __SNOWPACK_ENV__ from '/__snowpack__/env.js';\nimport.meta.env = __SNOWPACK_ENV__;\n` : ``) + '\n' + code;
}
async function wrapCssModuleResponse(url, code, ext, hasHmr = false) {
  let core = new Core();
  const {
    injectableSource,
    exportTokens
  } = await core.load(code, url, () => {
    throw new Error('Imports in CSS Modules are not yet supported.');
  });
  return `
export let code = ${JSON.stringify(injectableSource)};
let json = ${JSON.stringify(exportTokens)};
export default json;

const styleEl = document.createElement("style");
const codeEl = document.createTextNode(code);
styleEl.type = 'text/css';

styleEl.appendChild(codeEl);
document.head.appendChild(styleEl);
${hasHmr ? `
import * as __SNOWPACK_HMR_API__ from '/__snowpack__/hmr.js';
import.meta.hot = __SNOWPACK_HMR_API__.createHotContext(import.meta.url);
import.meta.hot.accept(({module}) => {
  code = module.code;
  json = module.default;
});
import.meta.hot.dispose(() => {
  document.head.removeChild(styleEl);
});
` : ``}`;
}
function wrapHtmlResponse(code, hasHmr = false) {
  if (hasHmr) {
    code += `<script type="module" src="/__snowpack__/hmr.js"></script>`;
  }

  return code;
}
function wrapEsmProxyResponse(url, code, ext, hasHmr = false) {
  if (ext === '.json') {
    return `
let json = ${JSON.stringify(JSON.parse(code))};
export default json;
${hasHmr ? `
import * as __SNOWPACK_HMR_API__ from '/__snowpack__/hmr.js';
import.meta.hot = __SNOWPACK_HMR_API__.createHotContext(import.meta.url);
import.meta.hot.accept(({module}) => {
  json = module.default;
});
` : ''}`;
  }

  if (ext === '.css') {
    return `
const code = ${JSON.stringify(code)};

const styleEl = document.createElement("style");
const codeEl = document.createTextNode(code);
styleEl.type = 'text/css';

styleEl.appendChild(codeEl);
document.head.appendChild(styleEl);
${hasHmr ? `
import * as __SNOWPACK_HMR_API__ from '/__snowpack__/hmr.js';
import.meta.hot = __SNOWPACK_HMR_API__.createHotContext(import.meta.url);
import.meta.hot.accept();
import.meta.hot.dispose(() => {
  document.head.removeChild(styleEl);
});
` : ''}`;
  }

  return `export default ${JSON.stringify(url)};`;
}
function getFileBuilderForWorker(cwd, selectedWorker, messageBus) {
  const {
    id,
    type,
    cmd,
    plugin
  } = selectedWorker;

  if (type !== 'build') {
    throw new Error(`scripts[${id}] is not a build script.`);
  }

  if (plugin === null || plugin === void 0 ? void 0 : plugin.build) {
    const buildFn = plugin.build;
    return async args => {
      try {
        const result = await buildFn(args);
        return result;
      } catch (err) {
        messageBus.emit('WORKER_MSG', {
          id,
          level: 'error',
          msg: err.message
        });
        messageBus.emit('WORKER_UPDATE', {
          id,
          state: ['ERROR', 'red']
        });
        return null;
      }
    };
  }

  return async ({
    contents,
    filePath
  }) => {
    let cmdWithFile = cmd.replace('$FILE', filePath);

    try {
      const {
        stdout,
        stderr
      } = await execa.command(cmdWithFile, {
        env: npmRunPath.env(),
        extendEnv: true,
        shell: true,
        input: contents,
        cwd
      });

      if (stderr) {
        messageBus.emit('WORKER_MSG', {
          id,
          level: 'warn',
          msg: `${filePath}\n${stderr}`
        });
      }

      return {
        result: stdout
      };
    } catch (err) {
      messageBus.emit('WORKER_MSG', {
        id,
        level: 'error',
        msg: `${filePath}\n${err.stderr}`
      });
      messageBus.emit('WORKER_UPDATE', {
        id,
        state: ['ERROR', 'red']
      });
      return null;
    }
  };
}
const PUBLIC_ENV_REGEX = /^SNOWPACK_PUBLIC_/;
function generateEnvModule(mode) {
  const envObject = _objectSpread2({}, process.env);

  for (const env of Object.keys(envObject)) {
    if (!PUBLIC_ENV_REGEX.test(env)) {
      delete envObject[env];
    }
  }

  envObject.MODE = mode;
  envObject.NODE_ENV = mode;
  return `export default ${JSON.stringify(envObject)};`;
}

let esbuildService = null;
function esbuildPlugin() {
  return {
    async build({
      contents,
      filePath
    }) {
      esbuildService = esbuildService || (await esbuild.startService());
      const isPreact = checkIsPreact(filePath, contents);
      const {
        js,
        warnings
      } = await esbuildService.transform(contents, {
        loader: path.extname(filePath).substr(1),
        jsxFactory: isPreact ? 'h' : undefined,
        jsxFragment: isPreact ? 'Fragment' : undefined
      });

      for (const warning of warnings) {
        console.error(chalk.bold('! ') + filePath);
        console.error('  ' + warning.text);
      }

      return {
        result: js || ''
      };
    }

  };
}
function stopEsbuild() {
  esbuildService && esbuildService.stop();
}

/**
 * Given an install specifier, attempt to resolve it from the CDN.
 * If no lockfile exists or if the entry is not found in the lockfile, attempt to resolve
 * it from the CDN directly. Otherwise, use the URL found in the lockfile and attempt to
 * check the local cache first.
 *
 * All resolved URLs are populated into the local cache, where our internal Rollup engine
 * will load them from when it installs your dependencies to disk.
 */

async function resolveDependency(installSpecifier, packageSemver, lockfile, canRetry = true) {
  // Right now, the CDN is only for top-level JS packages. The CDN doesn't support CSS,
  // non-JS assets, and has limited support for deep package imports. Snowpack
  // will automatically fall-back any failed/not-found assets from local
  // node_modules/ instead.
  if (!validatePackageName(installSpecifier).validForNewPackages) {
    return null;
  } // Grab the installUrl from our lockfile if it exists, otherwise resolve it yourself.


  let installUrl;
  let installUrlType;

  if (lockfile && lockfile.imports[installSpecifier]) {
    installUrl = lockfile.imports[installSpecifier];
    installUrlType = 'pin';
  } else {
    if (packageSemver === 'latest') {
      console.warn(`warn(${installSpecifier}): Not found in "dependencies". Using latest package version...`);
    }

    if (packageSemver.startsWith('npm:@reactesm') || packageSemver.startsWith('npm:@pika/react')) {
      throw new Error(`React workaround packages no longer needed! Revert to the official React & React-DOM packages.`);
    }

    if (packageSemver.includes(' ') || packageSemver.includes(':')) {
      console.warn(`warn(${installSpecifier}): Can't fetch complex semver "${packageSemver}" from remote CDN.`);
      return null;
    }

    installUrlType = 'lookup';
    installUrl = `${PIKA_CDN}/${installSpecifier}@${packageSemver}`;
  } // Hashed CDN urls never change, so its safe to grab them directly from the local cache
  // without a network request.


  if (installUrlType === 'pin') {
    const cachedResult = await cacache.get.info(RESOURCE_CACHE, installUrl).catch(() => null);

    if (cachedResult) {
      if (cachedResult.metadata) {
        const {
          pinnedUrl
        } = cachedResult.metadata;
        return pinnedUrl;
      }
    }
  } // Otherwise, resolve from the CDN remotely.


  const {
    statusCode,
    headers,
    body
  } = await fetchCDNResource(installUrl);

  if (statusCode !== 200) {
    console.warn(`Failed to resolve [${statusCode}]: ${installUrl} (${body})`);
    console.warn(`Falling back to local copy...`);
    return null;
  }

  let importUrlPath = headers['x-import-url'];
  let pinnedUrlPath = headers['x-pinned-url'];
  const buildStatus = headers['x-import-status'];
  const typesUrlPath = headers['x-typescript-types'];
  const typesUrl = typesUrlPath && `${PIKA_CDN}${typesUrlPath}`;

  if (installUrlType === 'pin') {
    const pinnedUrl = installUrl;
    await cacache.put(RESOURCE_CACHE, pinnedUrl, body, {
      metadata: {
        pinnedUrl,
        typesUrl
      }
    });
    return pinnedUrl;
  }

  if (pinnedUrlPath) {
    const pinnedUrl = `${PIKA_CDN}${pinnedUrlPath}`;
    await cacache.put(RESOURCE_CACHE, pinnedUrl, body, {
      metadata: {
        pinnedUrl,
        typesUrl
      }
    });
    return pinnedUrl;
  }

  if (buildStatus === 'SUCCESS') {
    console.warn(`Failed to lookup [${statusCode}]: ${installUrl}`);
    console.warn(`Falling back to local copy...`);
    return null;
  }

  if (!canRetry || buildStatus === 'FAIL') {
    console.warn(`Failed to build: ${installSpecifier}@${packageSemver}`);
    console.warn(`Falling back to local copy...`);
    return null;
  }

  console.log(chalk.cyan(`Building ${installSpecifier}@${packageSemver}... (This takes a moment, but will be cached for future use)`));

  if (!importUrlPath) {
    throw new Error('X-Import-URL header expected, but none received.');
  }

  const {
    statusCode: lookupStatusCode
  } = await fetchCDNResource(importUrlPath);

  if (lookupStatusCode !== 200) {
    throw new Error(`Unexpected response [${lookupStatusCode}]: ${PIKA_CDN}${importUrlPath}`);
  }

  return resolveDependency(installSpecifier, packageSemver, lockfile, false);
}

async function resolveTargetsFromRemoteCDN(lockfile, pkgManifest, config) {
  const downloadQueue = new PQueue({
    concurrency: 16
  });
  const newLockfile = {
    imports: {}
  };
  let resolutionError;

  for (const [installSpecifier, installSemver] of Object.entries(config.webDependencies)) {
    downloadQueue.add(async () => {
      try {
        const resolvedUrl = await resolveDependency(installSpecifier, installSemver, lockfile);

        if (resolvedUrl) {
          newLockfile.imports[installSpecifier] = resolvedUrl;
        }
      } catch (err) {
        resolutionError = resolutionError || err;
      }
    });
  }

  await downloadQueue.onIdle();

  if (resolutionError) {
    throw resolutionError;
  }

  return newLockfile;
}

function getInjectorCode(name, code) {
  return `
/** SNOWPACK INJECT STYLE: ${name} */
function __snowpack__injectStyle(css) {
  const headEl = document.head || document.getElementsByTagName('head')[0];
  const styleEl = document.createElement('style');
  styleEl.type = 'text/css';
  if (styleEl.styleSheet) {
    styleEl.styleSheet.cssText = css;
  } else {
    styleEl.appendChild(document.createTextNode(css));
  }
  headEl.appendChild(styleEl);
}
__snowpack__injectStyle(${JSON.stringify(code)});\n`;
}
/**
 * rollup-plugin-css
 *
 * Support installing any imported CSS into your dependencies. This isn't strictly valid
 * ESM code, but it is popular in the npm ecosystem & web development ecosystems. It also
 * solves a problem that is difficult to solve otherwise (referencing CSS from JS) so for
 * those reasons we have added default support for importing CSS into Snowpack v2.
 */


function rollupPluginCss() {
  return {
    name: 'snowpack:rollup-plugin-css',

    resolveId(source, importer) {
      if (!source.endsWith('.css')) {
        return null;
      }

      return this.resolve(source, importer, {
        skipSelf: true
      }).then(resolved => {
        return resolved || null;
      });
    },

    async load(id) {
      if (!id.endsWith('.css')) {
        return null;
      }

      const code = await fs.promises.readFile(id, {
        encoding: 'utf8'
      });
      const humanReadableName = id.replace(/.*node_modules[\/\\]/, '').replace(/[\/\\]/g, '/');
      return getInjectorCode(humanReadableName, code);
    }

  };
}

const IS_DEEP_PACKAGE_IMPORT = /^(@[\w-]+\/)?([\w-]+)\/(.*)/;
/**
 * rollup-plugin-entrypoint-alias
 *
 * Aliases any deep imports from a package to the package name, so that
 * chunking can happen more accurately.
 *
 * Example: lit-element imports from both 'lit-html' & 'lit-html/lit-html.js'.
 * Even though both eventually resolve to the same place, without this plugin
 * we lose the ability to mark "lit-html" as an external package.
 */

function rollupPluginEntrypointAlias({
  cwd
}) {
  return {
    name: 'snowpack:rollup-plugin-entrypoint-alias',

    resolveId(source, importer) {
      if (!IS_DEEP_PACKAGE_IMPORT.test(source)) {
        return null;
      }

      const [, packageScope, packageName] = source.match(IS_DEEP_PACKAGE_IMPORT);
      const packageFullName = packageScope ? `${packageScope}${packageName}` : packageName;
      let manifest;

      try {
        const [, _manifest] = resolveDependencyManifest(packageFullName, cwd);
        manifest = _manifest;
      } catch (err) {
        return null;
      }

      if (!manifest) {
        return null;
      }

      let needsAlias = typeof manifest.module === 'string' && source === path.posix.join(packageFullName, manifest.module) || typeof manifest.browser === 'string' && source === path.posix.join(packageFullName, manifest.browser) || typeof manifest.main === 'string' && source === path.posix.join(packageFullName, manifest.main);

      if (!needsAlias) {
        return null;
      }

      return this.resolve(packageFullName, importer, {
        skipSelf: true
      }).then(resolved => {
        return resolved || null;
      });
    }

  };
}

/**
 * rollup-plugin-react-fix
 *
 * React is such a strange package, and causes some strange bug in
 * Rollup where this export is expected but missing. Adding it back
 * ourselves manually here.
 */

function rollupPluginReactFix() {
  return {
    name: 'snowpack:rollup-plugin-react-fix',

    transform(code, id) {
      if (id.endsWith(path.join('react', 'index.js')) && !code.includes('as __moduleExports')) {
        return code + `\nexport { react as __moduleExports };`;
      }

      if (id.endsWith(path.join('react-dom', 'index.js')) && !code.includes('as __moduleExports')) {
        return code + `\nexport { reactDom as __moduleExports };`;
      }
    }

  };
}

const CACHED_FILE_ID_PREFIX = 'snowpack-pkg-cache:';
const PIKA_CDN_TRIM_LENGTH = PIKA_CDN.length;
/**
 * rollup-plugin-remote-cdn
 *
 * Load import URLs from a remote CDN, sitting behind a local cache. The local
 * cache acts as a go-between for the resolve & load step: when we get back a
 * successful CDN resolution, we save the file to the local cache and then tell
 * rollup that it's safe to load from the cache in the `load()` hook.
 */

function rollupPluginDependencyCache({
  installTypes,
  log
}) {
  const allTypesToInstall = new Set();
  return {
    name: 'snowpack:rollup-plugin-remote-cdn',

    async resolveId(source, importer) {
      let cacheKey;

      if (source.startsWith(PIKA_CDN)) {
        cacheKey = source;
      } else if (source.startsWith('/-/')) {
        cacheKey = PIKA_CDN + source;
      } else if (source.startsWith('/pin/')) {
        cacheKey = PIKA_CDN + source;
      } else {
        return null;
      } // If the source path is a CDN path including a hash, it's assumed the
      // file will never change and it is safe to pull from our local cache
      // without a network request.


      log(cacheKey);

      if (HAS_CDN_HASH_REGEX.test(cacheKey)) {
        const cachedResult = await cacache.get.info(RESOURCE_CACHE, cacheKey).catch(() =>
          /* ignore */
          null);

        if (cachedResult) {
          return CACHED_FILE_ID_PREFIX + cacheKey;
        }
      } // Otherwise, make the remote request and cache the file on success.


      const response = await fetchCDNResource(cacheKey);

      if (response.statusCode === 200) {
        const typesUrlPath = response.headers['x-typescript-types'];
        const pinnedUrlPath = response.headers['x-pinned-url'];
        const typesUrl = typesUrlPath && `${PIKA_CDN}${typesUrlPath}`;
        const pinnedUrl = pinnedUrlPath && `${PIKA_CDN}${pinnedUrlPath}`;
        await cacache.put(RESOURCE_CACHE, cacheKey, response.body, {
          metadata: {
            pinnedUrl,
            typesUrl
          }
        });
        return CACHED_FILE_ID_PREFIX + cacheKey;
      } // If lookup failed, skip this plugin and resolve the import locally instead.
      // TODO: Log that this has happened (if some sort of verbose mode is enabled).


      const packageName = cacheKey.substring(PIKA_CDN_TRIM_LENGTH).replace('/-/', '').replace('/pin/', '').split('@')[0];
      return this.resolve(packageName, importer, {
        skipSelf: true
      }).then(resolved => {
        let finalResult = resolved;

        if (!finalResult) {
          finalResult = {
            id: packageName
          };
        }

        return finalResult;
      });
    },

    async load(id) {
      var _cachedResult$metadat;

      if (!id.startsWith(CACHED_FILE_ID_PREFIX)) {
        return null;
      }

      const cacheKey = id.substring(CACHED_FILE_ID_PREFIX.length);
      log(cacheKey);
      const cachedResult = await cacache.get(RESOURCE_CACHE, cacheKey);
      const typesUrl = (_cachedResult$metadat = cachedResult.metadata) === null || _cachedResult$metadat === void 0 ? void 0 : _cachedResult$metadat.typesUrl;

      if (typesUrl && installTypes) {
        const typesTarballUrl = typesUrl.replace(/(mode=types.*?)\/.*/, '$1/all.tgz');
        allTypesToInstall.add(typesTarballUrl);
      }

      return cachedResult.data.toString('utf8');
    },

    async writeBundle(options) {
      if (!installTypes) {
        return;
      }

      await mkdirp(path.join(options.dir, '.types'));
      const tempDir = await cacache.tmp.mkdir(RESOURCE_CACHE);

      for (const typesTarballUrl of allTypesToInstall) {
        let tarballContents;
        const cachedTarball = await cacache.get(RESOURCE_CACHE, typesTarballUrl).catch(() =>
          /* ignore */
          null);

        if (cachedTarball) {
          tarballContents = cachedTarball.data;
        } else {
          const tarballResponse = await fetchCDNResource(typesTarballUrl, 'buffer');

          if (tarballResponse.statusCode !== 200) {
            continue;
          }

          tarballContents = tarballResponse.body;
          await cacache.put(RESOURCE_CACHE, typesTarballUrl, tarballContents);
        }

        const typesUrlParts = url.parse(typesTarballUrl).pathname.split('/');
        const typesPackageName = url.parse(typesTarballUrl).pathname.startsWith('/-/@') ? typesUrlParts[2] + '/' + typesUrlParts[3].split('@')[0] : typesUrlParts[2].split('@')[0];
        const typesPackageTarLoc = path.join(tempDir, `${typesPackageName}.tgz`);

        if (typesPackageName.includes('/')) {
          await mkdirp(path.dirname(typesPackageTarLoc));
        }

        fs__default.writeFileSync(typesPackageTarLoc, tarballContents);
        const typesPackageLoc = path.join(options.dir, `.types/${typesPackageName}`);
        await mkdirp(typesPackageLoc);
        await tar.x({
          file: typesPackageTarLoc,
          cwd: typesPackageLoc
        });
      }
    }

  };
}

function rollupPluginDependencyStats(cb) {
  let outputDir;
  let existingFileCache = {};
  let statsSummary = {
    direct: {},
    common: {}
  };

  function buildExistingFileCache(bundle) {
    for (let fileName of Object.keys(bundle)) {
      const filePath = path.join(outputDir, fileName);

      if (fs__default.existsSync(filePath)) {
        const {
          size
        } = fs__default.statSync(filePath);
        existingFileCache[fileName] = size;
      }
    }
  }

  function compareDependencies(files, type) {
    for (let {
      fileName,
      contents
    } of files) {
      const size = contents.byteLength;
      statsSummary[type][fileName] = {
        size: size,
        gzip: zlib.gzipSync(contents).byteLength,
        brotli: zlib.brotliCompressSync ? zlib.brotliCompressSync(contents).byteLength : 0
      };

      if (existingFileCache[fileName]) {
        const delta = (size - existingFileCache[fileName]) / 1000;
        statsSummary[type][fileName].delta = delta;
      }
    }
  }

  return {
    name: 'snowpack:rollup-plugin-stats',

    generateBundle(options, bundle) {
      outputDir = options.dir;
      buildExistingFileCache(bundle);
    },

    writeBundle(options, bundle) {
      const directDependencies = [];
      const commonDependencies = [];

      for (const [fileName, assetOrChunk] of Object.entries(bundle)) {
        const raw = assetOrChunk.type === 'asset' ? assetOrChunk.source : assetOrChunk.code;
        const contents = Buffer.isBuffer(raw) ? raw : typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.from(raw);

        if (fileName.startsWith('common')) {
          commonDependencies.push({
            fileName,
            contents
          });
        } else {
          directDependencies.push({
            fileName,
            contents
          });
        }
      }

      compareDependencies(directDependencies, 'direct');
      compareDependencies(commonDependencies, 'common');
      cb(statsSummary);
    }

  };
}

const WEB_MODULES_TOKEN = 'web_modules/';
const WEB_MODULES_TOKEN_LENGTH = WEB_MODULES_TOKEN.length; // [@\w] - Match a word-character or @ (valid package name)
// (?!.*(:\/\/)) - Ignore if previous match was a protocol (ex: http://)

const BARE_SPECIFIER_REGEX = /^[@\w](?!.*(:\/\/))/;
const ESM_IMPORT_REGEX = /import(?:["'\s]*([\w*${}\n\r\t, ]+)\s*from\s*)?\s*["'](.*?)["']/gm;
const ESM_DYNAMIC_IMPORT_REGEX = /import\((?:['"].+['"]|`[^$]+`)\)/gm;
const HAS_NAMED_IMPORTS_REGEX = /^[\t-\r ,0-9A-Z_a-z\xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\{([\s\S]*)\}/;
const SPLIT_NAMED_IMPORTS_REGEX = /\bas[\t-\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+[0-9A-Z_a-z]+|,/;
const DEFAULT_IMPORT_REGEX = /import[\t-\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+([0-9A-Z_a-z])+(,[\t-\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]\{[\t-\r 0-9A-Z_a-z\xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\})?[\t-\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+from/;
const HTML_JS_REGEX = /<script[\s\S]*?>([\s\S]*)<\/script>/gm;

function stripJsExtension(dep) {
  return dep.replace(/\.m?js$/i, '');
}

function createInstallTarget(specifier, all = true) {
  return {
    specifier,
    all,
    default: false,
    namespace: false,
    named: []
  };
}

function removeSpecifierQueryString(specifier) {
  const queryStringIndex = specifier.indexOf('?');

  if (queryStringIndex >= 0) {
    specifier = specifier.substring(0, queryStringIndex);
  }

  return specifier;
}

function getWebModuleSpecifierFromCode(code, imp) {
  // import.meta: we can ignore
  if (imp.d === -2) {
    return null;
  } // Static imports: easy to parse


  if (imp.d === -1) {
    return code.substring(imp.s, imp.e);
  } // Dynamic imports: a bit trickier to parse. Today, we only support string literals.


  const importStatement = code.substring(imp.s, imp.e);
  const importSpecifierMatch = importStatement.match(/^\s*['"](.*)['"]\s*$/m);
  return importSpecifierMatch ? importSpecifierMatch[1] : null;
}
/**
 * parses an import specifier, looking for a web modules to install. If a web module is not detected,
 * null is returned.
 */


function parseWebModuleSpecifier(specifier) {
  if (!specifier) {
    return null;
  } // If specifier is a "bare module specifier" (ie: package name) just return it directly


  if (BARE_SPECIFIER_REGEX.test(specifier)) {
    return specifier;
  } // Clean the specifier, remove any query params that may mess with matching


  const cleanedSpecifier = removeSpecifierQueryString(specifier); // Otherwise, check that it includes the "web_modules/" directory

  const webModulesIndex = cleanedSpecifier.indexOf(WEB_MODULES_TOKEN);

  if (webModulesIndex === -1) {
    return null;
  } // Check if this matches `@scope/package.js` or `package.js` format.
  // If it is, assume that this is a top-level pcakage that should be installed without the “.js”


  const resolvedSpecifier = cleanedSpecifier.substring(webModulesIndex + WEB_MODULES_TOKEN_LENGTH);
  const resolvedSpecifierWithoutExtension = stripJsExtension(resolvedSpecifier);

  if (validatePackageName(resolvedSpecifierWithoutExtension).validForNewPackages) {
    return resolvedSpecifierWithoutExtension;
  } // Otherwise, this is an explicit import to a file within a package.


  return resolvedSpecifier;
}

function parseImportStatement(code, imp) {
  const webModuleSpecifier = parseWebModuleSpecifier(getWebModuleSpecifierFromCode(code, imp));

  if (!webModuleSpecifier) {
    return null;
  }

  const importStatement = code.substring(imp.ss, imp.se);

  if (/^import\s+type/.test(importStatement)) {
    return null;
  }

  const dynamicImport = imp.d > -1;
  const defaultImport = !dynamicImport && DEFAULT_IMPORT_REGEX.test(importStatement);
  const namespaceImport = !dynamicImport && importStatement.includes('*');
  const namedImports = (importStatement.match(HAS_NAMED_IMPORTS_REGEX) || [, ''])[1].split(SPLIT_NAMED_IMPORTS_REGEX).map(name => name.trim()).filter(isTruthy);
  return {
    specifier: webModuleSpecifier,
    all: dynamicImport,
    default: defaultImport,
    namespace: namespaceImport,
    named: namedImports
  };
}

function cleanCodeForParsing(code) {
  code = stripComments(code);
  const allMatches = [];
  let match;

  while (match = ESM_IMPORT_REGEX.exec(code)) {
    allMatches.push(match);
  }

  while (match = ESM_DYNAMIC_IMPORT_REGEX.exec(code)) {
    allMatches.push(match);
  }

  return allMatches.map(([full]) => full).join('\n');
}

function parseCodeForInstallTargets(fileLoc, code) {
  let imports; // Attempt #1: Parse the file as JavaScript. JSX and some decorator
  // syntax will break this.

  try {
    if (fileLoc.endsWith('.jsx') || fileLoc.endsWith('.tsx')) {
      // We know ahead of time that this will almost certainly fail.
      // Just jump right to the secondary attempt.
      throw new Error('JSX must be cleaned before parsing');
    }

    [imports] = esModuleLexer.parse(code) || [];
  } catch (err) {
    // Attempt #2: Parse only the import statements themselves.
    // This lets us guarentee we aren't sending any broken syntax to our parser,
    // but at the expense of possible false +/- caused by our regex extractor.
    try {
      code = cleanCodeForParsing(code);
      [imports] = esModuleLexer.parse(code) || [];
    } catch (err) {
      // Another error! No hope left, just abort.
      console.error(chalk.red(`! ${fileLoc}`));
      throw err;
    }
  }

  const allImports = imports.map(imp => parseImportStatement(code, imp)).filter(isTruthy) // Babel macros are not install targets!
    .filter(imp => !imp.specifier.endsWith('.macro'));
  return allImports;
}

function scanDepList(depList, cwd) {
  return depList.map(whitelistItem => {
    if (!glob.hasMagic(whitelistItem)) {
      return [createInstallTarget(whitelistItem, true)];
    } else {
      const nodeModulesLoc = path.join(cwd, 'node_modules');
      return scanDepList(glob.sync(whitelistItem, {
        cwd: nodeModulesLoc,
        nodir: true
      }), cwd);
    }
  }).reduce((flat, item) => flat.concat(item), []);
}
async function scanImports(cwd, {
  scripts,
  exclude
}) {
  await esModuleLexer.init;
  const includeFileSets = await Promise.all(scripts.map(({
    id,
    type,
    cmd,
    args
  }) => {
    if (type !== 'mount') {
      return [];
    }

    if (args.fromDisk.includes('web_modules')) {
      return [];
    }

    const dirDisk = path.resolve(cwd, args.fromDisk);
    return glob.sync(`**/*`, {
      ignore: exclude.concat(['**/web_modules/**/*']),
      cwd: dirDisk,
      absolute: true,
      nodir: true
    });
  }));
  const includeFiles = Array.from(new Set([].concat.apply([], includeFileSets)));

  if (includeFiles.length === 0) {
    return [];
  } // Scan every matched JS file for web dependency imports


  const loadedFiles = await Promise.all(includeFiles.map(async filePath => {
    const ext = path.extname(filePath); // Always ignore dotfiles

    if (filePath.startsWith('.')) {
      return null;
    } // Probably a license, a README, etc


    if (ext === '') {
      return null;
    } // Our import scanner can handle normal JS & even TypeScript without a problem.


    if (ext === '.js' || ext === '.mjs' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
      const str = fs__default.readFileSync(filePath, 'utf-8')
      const fileName = filePath.split('/').slice(-1)[0]
      const result = babel.parseSync(str, { filename: fileName })
      const tranForm = babel.transformFromAstSync(result, '', { filename: fileName })
      return [filePath, tranForm.code];
    }

    if (ext === '.vue' || ext === '.svelte') {
      const result = await fs__default.promises.readFile(filePath, 'utf-8'); // TODO: Replace with matchAll once Node v10 is out of TLS.
      // const allMatches = [...result.matchAll(HTML_JS_REGEX)];

      const allMatches = [];
      let match;

      while (match = HTML_JS_REGEX.exec(result)) {
        allMatches.push(match);
      }

      return [filePath, allMatches.map(([full, code]) => code).join('\n')];
    } // If we don't recognize the file type, it could be source. Warn just in case.


    if (!mime.lookup(path.extname(filePath))) {
      console.warn(chalk.dim(`ignoring unsupported file "${path.relative(process.cwd(), filePath)}"`));
    }

    return null;
  }));
  return loadedFiles.filter(isTruthy).map(([fileLoc, code]) => parseCodeForInstallTargets(fileLoc, code)).reduce((flat, item) => flat.concat(item), []) // Ignore source imports that match a mount directory.
    .filter(target => !findMatchingMountScript(scripts, target.specifier)).sort((impA, impB) => impA.specifier.localeCompare(impB.specifier));
}

/** The minimum width, in characters, of each size column */

const SIZE_COLUMN_WIDTH = 11;
/** Generic Object.entries() alphabetical sort by keys. */

function entriesSort([filenameA], [filenameB]) {
  return filenameA.localeCompare(filenameB);
}
/** Pretty-prints number of bytes as "XXX KB" */


function formatSize(size) {
  let kb = Math.round(size / 1000 * 100) / 100;

  if (kb >= 1000) {
    kb = Math.floor(kb);
  }

  let color;

  if (kb < 15) {
    color = 'green';
  } else if (kb < 30) {
    color = 'yellow';
  } else {
    color = 'red';
  }

  return chalk[color](`${kb} KB`.padEnd(SIZE_COLUMN_WIDTH));
}

function formatDelta(delta) {
  const kb = Math.round(delta * 100) / 100;
  const color = delta > 0 ? 'red' : 'green';
  return chalk[color](`Δ ${delta > 0 ? '+' : ''}${kb} KB`);
}

function formatFileInfo(filename, stats, padEnd, isLastFile) {
  const lineGlyph = chalk.dim(isLastFile ? '└─' : '├─');
  const lineName = filename.padEnd(padEnd);
  const fileStat = formatSize(stats.size);
  const gzipStat = formatSize(stats.gzip);
  const brotliStat = formatSize(stats.brotli);
  const lineStat = fileStat + gzipStat + brotliStat;
  let lineDelta = '';

  if (stats.delta) {
    lineDelta = chalk.dim('[') + formatDelta(stats.delta) + chalk.dim(']');
  } // Trim trailing whitespace (can mess with formatting), but keep indentation.


  return `    ` + `${lineGlyph} ${lineName} ${lineStat} ${lineDelta}`.trim();
}

function formatFiles(files, padEnd) {
  const strippedFiles = files.map(([filename, stats]) => [filename.replace(/^common\//, ''), stats]);
  return strippedFiles.map(([filename, stats], index) => formatFileInfo(filename, stats, padEnd, index >= files.length - 1)).join('\n');
}

function printStats(dependencyStats) {
  let output = '';
  const {
    direct,
    common
  } = dependencyStats;
  const allDirect = Object.entries(direct).sort(entriesSort);
  const allCommon = Object.entries(common).sort(entriesSort);
  const maxFileNameLength = [...allCommon, ...allDirect].reduce((max, [filename]) => Math.max(filename.length, max), 'web_modules/'.length) + 1;
  output += `  ⦿ ${chalk.bold('web_modules/'.padEnd(maxFileNameLength + 4))}` + chalk.bold.underline('size'.padEnd(SIZE_COLUMN_WIDTH - 2)) + '  ' + chalk.bold.underline('gzip'.padEnd(SIZE_COLUMN_WIDTH - 2)) + '  ' + chalk.bold.underline('brotli'.padEnd(SIZE_COLUMN_WIDTH - 2)) + `\n`;
  output += `${formatFiles(allDirect, maxFileNameLength)}\n`;

  if (Object.values(common).length > 0) {
    output += `  ⦿ ${chalk.bold('web_modules/common/ (Shared)')}\n`;
    output += `${formatFiles(allCommon, maxFileNameLength)}\n`;
  }

  return `\n${output}\n`;
}

class ErrorWithHint extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }

} // Add common, well-used non-esm packages here so that Rollup doesn't die trying to analyze them.


const PACKAGES_TO_AUTO_DETECT_EXPORTS = [path.join('react', 'index.js'), path.join('react-dom', 'index.js'), 'react-is', 'prop-types', 'scheduler', 'rxjs', 'exenv', 'body-scroll-lock'];
const cwd = process.cwd();
const banner = chalk.bold(`snowpack`) + ` installing... `;
let spinner = ora(banner);
let spinnerHasError = false;
let installResults = [];
let dependencyStats = null;

function defaultLogError(msg) {
  if (!spinnerHasError) {
    spinner.stopAndPersist({
      symbol: chalk.cyan('⠼')
    });
  }

  spinnerHasError = true;
  spinner = ora(chalk.red(msg));
  spinner.fail();
}

function defaultLogUpdate(msg) {
  spinner.text = banner + msg;
}

function formatInstallResults() {
  return installResults.map(([d, result]) => {
    if (result === 'SUCCESS') {
      return chalk.green(d);
    }

    if (result === 'ASSET') {
      return chalk.yellow(d);
    }

    if (result === 'FAIL') {
      return chalk.red(d);
    }

    return d;
  }).join(', ');
}

function detectExports(filePath) {
  try {
    const fileLoc = require.resolve(filePath, {
      paths: [cwd]
    });

    if (fs__default.existsSync(fileLoc)) {
      return Object.keys(require(fileLoc));
    }
  } catch (err) {// ignore
  }

  return [];
}
/**
 * Formats the snowpack dependency name from a "webDependencies" input value:
 * 2. Remove any ".js"/".mjs" extension (will be added automatically by Rollup)
 */


function getWebDependencyName(dep) {
  return dep.replace(/\.m?js$/i, '');
}
/**
 * Takes object of env var mappings and converts it to actual
 * replacement specs as expected by @rollup/plugin-replace. The
 * `optimize` arg is used to derive NODE_ENV default.
 *
 * @param env
 * @param optimize
 */


function getRollupReplaceKeys(env) {
  const result = Object.keys(env).reduce((acc, id) => {
    const val = env[id];
    acc[`process.env.${id}`] = `${JSON.stringify(val === true ? process.env[id] : val)}`;
    return acc;
  }, {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    'process.platform': JSON.stringify('browser'),
    'process.env.': '({}).'
  });
  return result;
}
/**
 * Resolve a "webDependencies" input value to the correct absolute file location.
 * Supports both npm package names, and file paths relative to the node_modules directory.
 * Follows logic similar to Node's resolution logic, but using a package.json's ESM "module"
 * field instead of the CJS "main" field.
 */


function resolveWebDependency(dep, isExplicit) {
  // if dep includes a file extension, check that dep isn't a package before returning
  if (path.extname(dep) && !validatePackageName(dep).validForNewPackages) {
    const isJSFile = ['.js', '.mjs', '.cjs'].includes(path.extname(dep));
    return {
      type: isJSFile ? 'JS' : 'ASSET',
      loc: require.resolve(dep, {
        paths: [cwd]
      })
    };
  }

  const [depManifestLoc, depManifest] = resolveDependencyManifest(dep, cwd); // Fix: import '@material-ui/icons/AddBox' could be a JS file w/o a file extension.
  // Check Node's resolution logic in case this is actually a file.

  if (!depManifest) {
    try {
      const maybeLoc = require.resolve(dep, {
        paths: [cwd]
      });

      return {
        type: 'JS',
        loc: maybeLoc
      };
    } catch (err) {// Oh well, was worth a try
    }
  }

  if (!depManifest) {
    throw new ErrorWithHint(`Package "${dep}" not found. Have you installed it?`, depManifestLoc && chalk.italic(depManifestLoc));
  }

  if (depManifest.name && (depManifest.name.startsWith('@reactesm') || depManifest.name.startsWith('@pika/react'))) {
    throw new Error(`React workaround packages no longer needed! Revert back to the official React & React-DOM packages.`);
  }

  let foundEntrypoint = depManifest['browser:module'] || depManifest.module || depManifest['main:esnext'] || depManifest.browser; // Some packages define "browser" as an object. We'll do our best to find the
  // right entrypoint in an entrypoint object, or fail otherwise.
  // See: https://github.com/defunctzombie/package-browser-field-spec

  if (typeof foundEntrypoint === 'object') {
    foundEntrypoint = foundEntrypoint[dep] || foundEntrypoint['./index.js'] || foundEntrypoint['./index'] || foundEntrypoint['./'] || foundEntrypoint['.'];
  } // If the package was a part of the explicit whitelist, fallback to it's main CJS entrypoint.


  if (!foundEntrypoint && isExplicit) {
    foundEntrypoint = depManifest.main || 'index.js';
  }

  if (typeof foundEntrypoint !== 'string') {
    throw new Error(`"${dep}" has unexpected entrypoint: ${JSON.stringify(foundEntrypoint)}.`);
  }

  return {
    type: 'JS',
    loc: path.join(depManifestLoc, '..', foundEntrypoint)
  };
}

async function install(installTargets, {
  lockfile,
  logError,
  logUpdate
}, config) {
  const {
    webDependencies,
    installOptions: {
      installTypes,
      dest: destLoc,
      externalPackage: externalPackages,
      alias: installAlias,
      sourceMap,
      env,
      rollup: userDefinedRollup
    }
  } = config;

  const knownNamedExports = _objectSpread2({}, userDefinedRollup.namedExports);

  for (const filePath of PACKAGES_TO_AUTO_DETECT_EXPORTS) {
    knownNamedExports[filePath] = [...(knownNamedExports[filePath] || []), ...detectExports(filePath)];
  } // @ts-ignore


  if (!webDependencies && !process.versions.pnp && !fs__default.existsSync(path.join(cwd, 'node_modules'))) {
    logError('no "node_modules" directory exists. Did you run "npm install" first?');
    return;
  }

  const allInstallSpecifiers = new Set(installTargets.filter(dep => !externalPackages.includes(dep.specifier)).map(dep => dep.specifier).map(specifier => installAlias[specifier] || specifier).sort());
  const installEntrypoints = {};
  const assetEntrypoints = {};
  const importMap = {
    imports: {}
  };
  const installTargetsMap = {};

  for (const installSpecifier of allInstallSpecifiers) {
    const targetName = getWebDependencyName(installSpecifier);

    if (lockfile && lockfile.imports[installSpecifier]) {
      installEntrypoints[targetName] = lockfile.imports[installSpecifier];
      importMap.imports[installSpecifier] = `./${targetName}.js`;
      installResults.push([targetName, 'SUCCESS']);
      logUpdate(formatInstallResults());
      continue;
    }

    try {
      const {
        type: targetType,
        loc: targetLoc
      } = resolveWebDependency(installSpecifier, true);

      if (targetType === 'JS') {
        installEntrypoints[targetName] = targetLoc;
        importMap.imports[installSpecifier] = `./${targetName}.js`;
        Object.entries(installAlias).filter(([key, value]) => value === installSpecifier).forEach(([key, value]) => {
          importMap.imports[key] = `./${targetName}.js`;
        });
        installTargetsMap[targetLoc] = installTargets.filter(t => installSpecifier === t.specifier);
        installResults.push([installSpecifier, 'SUCCESS']);
      } else if (targetType === 'ASSET') {
        assetEntrypoints[targetName] = targetLoc;
        importMap.imports[installSpecifier] = `./${targetName}`;
        installResults.push([installSpecifier, 'ASSET']);
      }

      logUpdate(formatInstallResults());
    } catch (err) {
      installResults.push([installSpecifier, 'FAIL']);
      logUpdate(formatInstallResults());


      logError(err.message || err);

      if (err.hint) {
        // Note: Wait 1ms to guarantee a log message after the spinner
        setTimeout(() => console.log(err.hint), 1);
      }

      return false;
    }
  }

  if (Object.keys(installEntrypoints).length === 0 && Object.keys(assetEntrypoints).length === 0) {
    logError(`No ESM dependencies found!`);
    console.log(chalk.dim(`  At least one dependency must have an ESM "module" entrypoint. You can find modern, web-ready packages at ${chalk.underline('https://www.pika.dev')}`));
    return false;
  }

  let isCircularImportFound = false;
  const inputOptions = {
    input: installEntrypoints,
    external: externalPackages,
    treeshake: {
      moduleSideEffects: 'no-external'
    },
    plugins: [rollupPluginReplace(getRollupReplaceKeys(env)), rollupPluginEntrypointAlias({
      cwd
    }), !!webDependencies && rollupPluginDependencyCache({
      installTypes,
      log: url => logUpdate(chalk.dim(url))
    }), rollupPluginAlias({
      entries: Object.entries(installAlias).map(([alias, mod]) => ({
        find: alias,
        replacement: mod
      }))
    }), rollupPluginNodeResolve({
      mainFields: ['browser:module', 'module', 'browser', 'main'].filter(isTruthy),
      extensions: ['.mjs', '.cjs', '.js', '.json'],
      // whether to prefer built-in modules (e.g. `fs`, `path`) or local ones with the same names
      preferBuiltins: false,
      dedupe: userDefinedRollup.dedupe
    }), rollupPluginJson({
      preferConst: true,
      indent: '  ',
      compact: false,
      namedExports: true
    }), rollupPluginCss(), rollupPluginCommonjs({
      extensions: ['.js', '.cjs'],
      namedExports: knownNamedExports
    }), rollupPluginDependencyStats(info => dependencyStats = info), rollupPluginReactFix(), ...userDefinedRollup.plugins].filter(Boolean),

    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        if (!isCircularImportFound) {
          isCircularImportFound = true;
          logUpdate(`Warning: 1+ circular dependencies found via "${warning.importer}".`);
        }

        return;
      }

      if (warning.code === 'UNRESOLVED_IMPORT') {
        logError(`'${warning.source}' is imported by '${warning.importer}', but could not be resolved.`);

        if (isNodeBuiltin(warning.source)) {
          console.log(chalk.dim(`  '${warning.source}' is a Node.js builtin module that won't exist in the browser.`));
          console.log(chalk.dim(`  Search pika.dev for a web-friendly alternative to ${chalk.bold(warning.importer)}`));
          console.log(chalk.dim(`  Or, add ${chalk.bold('"rollup-plugin-node-polyfills"')} to installOptions.rollup.plugins in your Snowpack config file.`));
        } else {
          console.log(chalk.dim(`  Make sure that the package is installed and that the file exists.`));
        }

        return;
      }

      warn(warning);
    }

  };
  const outputOptions = {
    dir: destLoc,
    format: 'esm',
    sourcemap: sourceMap,
    exports: 'named',
    chunkFileNames: 'common/[name]-[hash].js'
  };

  if (Object.keys(installEntrypoints).length > 0) {
    try {
      const packageBundle = await rollup.rollup(inputOptions);
      logUpdate(formatInstallResults());
      await packageBundle.write(outputOptions);
    } catch (_err) {
      var _err$loc;

      const err = _err;
      const errFilePath = ((_err$loc = err.loc) === null || _err$loc === void 0 ? void 0 : _err$loc.file) || err.id;

      if (!errFilePath) {
        throw err;
      } // NOTE: Rollup will fail instantly on most errors. Therefore, we can
      // only report one error at a time. `err.watchFiles` also exists, but
      // for now `err.loc.file` and `err.id` have all the info that we need.


      const failedExtension = path.extname(errFilePath);
      const suggestion = MISSING_PLUGIN_SUGGESTIONS[failedExtension] || err.message; // Display posix-style on all environments, mainly to help with CI :)

      const fileName = errFilePath.replace(cwd + path.sep, '').replace(/\\/g, '/');
      logError(`${chalk.bold('snowpack')} failed to load ${chalk.bold(fileName)}\n  ${suggestion}`);
      return;
    }
  }

  await writeLockfile(path.join(destLoc, 'import-map.json'), importMap);
  Object.entries(assetEntrypoints).forEach(([assetName, assetLoc]) => {
    mkdirp.sync(path.dirname(`${destLoc}/${assetName}`));
    fs__default.copyFileSync(assetLoc, `${destLoc}/${assetName}`);
  });
  return true;
}
async function command({
  cwd,
  config,
  lockfile,
  pkgManifest
}) {
  const {
    installOptions: {
      dest
    },
    knownEntrypoints,
    webDependencies
  } = config;
  installResults = [];
  dependencyStats = null;
  spinner = ora(banner);
  spinnerHasError = false;
  let newLockfile = null;
  const installTargets = [];

  if (knownEntrypoints) {
    installTargets.push(...scanDepList(knownEntrypoints, cwd));
  }

  if (webDependencies) {
    installTargets.push(...scanDepList(Object.keys(webDependencies), cwd));
  }

  {
    installTargets.push(...(await scanImports(cwd, config)));
  }

  if (installTargets.length === 0) {
    defaultLogError('Nothing to install.');
    return;
  }

  spinner.start();
  const startTime = Date.now();

  if (webDependencies && Object.keys(webDependencies).length > 0) {
    newLockfile = await resolveTargetsFromRemoteCDN(lockfile, pkgManifest, config).catch(err => {
      defaultLogError(err.message || err);
      process.exit(1);
    });
  }

  rimraf.sync(dest);
  await mkdirp(dest);
  const finalResult = await install(installTargets, {
    lockfile: newLockfile,
    logError: defaultLogError,
    logUpdate: defaultLogUpdate
  }, config).catch(err => {
    if (err.loc) {
      console.log('\n' + chalk.red.bold(`✘ ${err.loc.file}`));
    }

    if (err.url) {
      console.log(chalk.dim(`👉 ${err.url}`));
    }

    throw err;
  });

  if (finalResult) {
    spinner.succeed(chalk.bold(`snowpack`) + ` install complete.` + chalk.dim(` [${((Date.now() - startTime) / 1000).toFixed(2)}s]`));

    if (!!dependencyStats) {
      console.log(printStats(dependencyStats));
    }
  }

  if (newLockfile) {
    await writeLockfile(path.join(cwd, 'snowpack.lock.json'), newLockfile);
  }

  if (spinnerHasError) {
    process.exit(1);
  }
}

const cwd$1 = process.cwd();

function getStateString(workerState, isWatch) {
  if (workerState.state) {
    if (Array.isArray(workerState.state)) {
      return [chalk[workerState.state[1]], workerState.state[0]];
    }

    return [chalk.dim, workerState.state];
  }

  if (workerState.done) {
    return workerState.error ? [chalk.red, 'FAIL'] : [chalk.green, 'DONE'];
  }

  if (isWatch) {
    if (workerState.config.watch) {
      return [chalk.dim, 'WATCH'];
    }
  }

  return [chalk.dim, 'READY'];
}

const WORKER_BASE_STATE = {
  done: false,
  error: null,
  output: ''
};
function paint(bus, registeredWorkers, buildMode, devMode) {
  let consoleOutput = '';
  let installOutput = '';
  let isInstalling = false;
  let hasBeenCleared = false;
  let missingWebModule = null;
  const allWorkerStates = {};

  for (const config of registeredWorkers) {
    allWorkerStates[config.id] = _objectSpread2(_objectSpread2({}, WORKER_BASE_STATE), {}, {
      config
    });
  }

  function repaint() {
    process.stdout.write(process.platform === 'win32' ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H');
    process.stdout.write(`${chalk.bold('Snowpack')}\n\n`); // Dashboard

    if (devMode) {
      process.stdout.write(`  ${chalk.bold.cyan(`http://localhost:${devMode.port}`)}`);

      for (const ip of devMode.ips) {
        process.stdout.write(`${chalk.cyan(` > `)}${chalk.bold.cyan(`http://${ip}:${devMode.port}`)}`);
      }

      process.stdout.write('\n' + chalk.dim(`  Server started in ${devMode.startTimeMs}ms.\n\n`));
    }

    if (buildMode) {
      process.stdout.write('  ' + chalk.bold.cyan(buildMode.dest));
      process.stdout.write(chalk.dim(` Building your application...\n\n`));
    }

    for (const config of registeredWorkers) {
      if (devMode && config.type === 'bundle') {
        continue;
      }

      const workerState = allWorkerStates[config.id];
      const dotLength = 24 - config.id.length;
      const dots = chalk.dim(''.padEnd(dotLength, '.'));
      const [fmt, stateString] = getStateString(workerState, !!devMode);
      const spacer = ' '; //.padEnd(8 - stateString.length);

      let cmdMsg = `${config.plugin && config.cmd[0] !== '(' ? '(plugin) ' : ''}${config.cmd}`;

      if (cmdMsg.length > 52) {
        cmdMsg = cmdMsg.substr(0, 52) + '...';
      }

      const cmdStr = stateString === 'FAIL' ? chalk.red(cmdMsg) : chalk.dim(cmdMsg);
      process.stdout.write(`  ${config.id}${dots}[${fmt(stateString)}]${spacer}${cmdStr}\n`);
    }

    process.stdout.write('\n');

    if (isInstalling) {
      process.stdout.write(`${chalk.underline.bold('▼ snowpack install')}\n\n`);
      process.stdout.write('  ' + installOutput.trim().replace(/\n/gm, '\n  '));
      process.stdout.write('\n\n');
      return;
    }

    if (missingWebModule) {
      const {
        id,
        pkgName,
        spec
      } = missingWebModule;
      process.stdout.write(`${chalk.red.underline.bold('▼ Snowpack')}\n\n`);

      if (devMode) {
        process.stdout.write(`  Package ${chalk.bold(pkgName)} not found!\n`);
        process.stdout.write(chalk.dim(`  in ${id}`));
        process.stdout.write(`\n\n`);
        process.stdout.write(`  ${chalk.bold('Press Enter')} to automatically run ${chalk.bold(isYarn(cwd$1) ? `yarn add ${pkgName}` : `npm install --save ${pkgName}`)}.\n`);
        process.stdout.write(`  Or, Exit Snowpack and install manually to continue.\n`);
      } else {
        process.stdout.write(`  Dependency ${chalk.bold(spec)} not found!\n\n`); // process.stdout.write(
        //   `  Run ${chalk.bold('snowpack install')} to install all required dependencies.\n\n`,
        // );

        process.exit(1);
      }

      return;
    }

    for (const config of registeredWorkers) {
      const workerState = allWorkerStates[config.id];

      if (workerState && workerState.output) {
        const chalkFn = Array.isArray(workerState.error) ? chalk.red : chalk;
        process.stdout.write(`${chalkFn.underline.bold('▼ ' + config.id)}\n\n`);
        process.stdout.write(workerState.output ? '  ' + workerState.output.trim().replace(/\n/gm, '\n  ') : hasBeenCleared ? chalk.dim('  Output cleared.') : chalk.dim('  No output, yet.'));
        process.stdout.write('\n\n');
      }
    }

    if (consoleOutput) {
      process.stdout.write(`${chalk.underline.bold('▼ Console')}\n\n`);
      process.stdout.write(consoleOutput ? '  ' + consoleOutput.trim().replace(/\n/gm, '\n  ') : hasBeenCleared ? chalk.dim('  Output cleared.') : chalk.dim('  No output, yet.'));
      process.stdout.write('\n\n');
    }

    const overallStatus = Object.values(allWorkerStates).reduce((result, {
      done,
      error
    }) => {
      return {
        done: result.done && done,
        error: result.error || error
      };
    });

    if (overallStatus.error) {
      process.stdout.write(`${chalk.underline.red.bold('▼ Result')}\n\n`);
      process.stdout.write('  ⚠️  Finished, with errors.');
      process.stdout.write('\n\n');
      process.exit(1);
    } else if (overallStatus.done) {
      process.stdout.write(`${chalk.underline.green.bold('▶ Build Complete!')}\n\n`);
    }
  }

  bus.on('WORKER_MSG', ({
    id,
    msg
  }) => {
    allWorkerStates[id].output += msg;
    repaint();
  });
  bus.on('WORKER_UPDATE', ({
    id,
    state
  }) => {
    if (typeof state !== undefined) {
      allWorkerStates[id].state = state;
    }

    repaint();
  });
  bus.on('WORKER_COMPLETE', ({
    id,
    error
  }) => {
    allWorkerStates[id].state = null;
    allWorkerStates[id].done = true;
    allWorkerStates[id].error = allWorkerStates[id].error || error;
    repaint();
  });
  bus.on('WORKER_RESET', ({
    id
  }) => {
    allWorkerStates[id] = _objectSpread2(_objectSpread2({}, WORKER_BASE_STATE), {}, {
      config: allWorkerStates[id].config
    });
    repaint();
  });
  bus.on('CONSOLE', ({
    level,
    args
  }) => {
    if (isInstalling) {
      const msg = util.format.apply(util, args);

      if (!msg.startsWith('[404] ')) {
        installOutput += msg;
      }
    } else {
      consoleOutput += `[${level}] ${util.format.apply(util, args)}\n`;
    }

    repaint();
  });
  bus.on('NEW_SESSION', () => {
    if (consoleOutput) {
      consoleOutput = ``;
      hasBeenCleared = true;
    } // Reset all per-file build scripts


    for (const config of registeredWorkers) {
      if (config.type === 'build') {
        allWorkerStates[config.id] = _objectSpread2(_objectSpread2({}, WORKER_BASE_STATE), {}, {
          config: allWorkerStates[config.id].config
        });
      }
    }

    repaint();
  });
  bus.on('INSTALLING', () => {
    isInstalling = true;
    installOutput = '';
    repaint();
  });
  bus.on('INSTALL_COMPLETE', () => {
    setTimeout(() => {
      missingWebModule = null;
      isInstalling = false;
      installOutput = '';
      consoleOutput = ``;
      hasBeenCleared = true;
      repaint();
    }, 2000);
  });
  bus.on('MISSING_WEB_MODULE', ({
    id,
    data
  }) => {
    if (!missingWebModule && data) {
      missingWebModule = _objectSpread2({
        id
      }, data);
    }

    if (missingWebModule && missingWebModule.id === id) {
      if (!data) {
        missingWebModule = null;
      } else {
        missingWebModule = _objectSpread2({
          id
        }, data);
      }
    }

    repaint();
  });

  if (devMode) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.on('line', input => {
      if (!missingWebModule) {
        return;
      }

      devMode.addPackage(missingWebModule.pkgName);
      repaint();
    });
    rl.on('close', function () {
      process.exit(0);
    });
  }

  repaint();
}

var srcFileExtensionMapping = {
  jsx: 'js',
  ts: 'js',
  tsx: 'js',
  vue: 'js',
  svelte: 'js',
  mdx: 'js',
  php: 'html',
  md: 'html',
  ejs: 'html',
  njk: 'html',
  scss: 'css',
  less: 'css'
};

async function command$1(commandOptions) {
  const {
    cwd,
    config
  } = commandOptions; // Start with a fresh install of your dependencies, for production

  commandOptions.config.installOptions.env.NODE_ENV = process.env.NODE_ENV || 'production';
  commandOptions.config.installOptions.dest = BUILD_DEPENDENCIES_DIR;
  const dependencyImportMapLoc = path.join(config.installOptions.dest, 'import-map.json'); // Start with a fresh install of your dependencies, if needed.

  if (!(await checkLockfileHash(BUILD_DEPENDENCIES_DIR)) || !fs.existsSync(dependencyImportMapLoc)) {
    console.log(chalk.yellow('! updating dependencies...'));
    await command(commandOptions);
    await updateLockfileHash(BUILD_DEPENDENCIES_DIR);
  }

  const messageBus = new events.EventEmitter();
  const relevantWorkers = [];
  const allBuildExtensions = [];
  let dependencyImportMap = {
    imports: {}
  };

  try {
    dependencyImportMap = require(dependencyImportMapLoc);
  } catch (err) {// no import-map found, safe to ignore
  }

  for (const workerConfig of config.scripts) {
    const {
      type,
      match
    } = workerConfig;

    if (type === 'build' || type === 'run' || type === 'mount' || type === 'bundle') {
      relevantWorkers.push(workerConfig);
    }

    if (type === 'build') {
      allBuildExtensions.push(...match);
    }
  }

  let isBundled = config.devOptions.bundle;
  let bundleWorker = config.scripts.find(s => s.type === 'bundle');
  const isBundledHardcoded = isBundled !== undefined;

  if (!isBundledHardcoded) {
    isBundled = !!bundleWorker;
  }

  if (!bundleWorker) {
    bundleWorker = {
      id: 'bundle:*',
      type: 'bundle',
      match: ['*'],
      cmd: '',
      watch: undefined
    };
    relevantWorkers.push(bundleWorker);
  }

  const buildDirectoryLoc = isBundled ? path.join(cwd, `.build`) : config.devOptions.out;
  const internalFilesBuildLoc = path.join(buildDirectoryLoc, '__snowpack__');
  const finalDirectoryLoc = config.devOptions.out;

  if (config.scripts.length <= 1) {
    console.error(chalk.red(`No build scripts found, so nothing to build.`));
    console.error(`See https://www.snowpack.dev/#build-scripts for help getting started.`);
    return;
  }

  rimraf.sync(buildDirectoryLoc);
  mkdirp.sync(buildDirectoryLoc);
  mkdirp.sync(internalFilesBuildLoc);

  if (finalDirectoryLoc !== buildDirectoryLoc) {
    rimraf.sync(finalDirectoryLoc);
    mkdirp.sync(finalDirectoryLoc);
  }

  console.log = (...args) => {
    messageBus.emit('CONSOLE', {
      level: 'log',
      args
    });
  };

  console.warn = (...args) => {
    messageBus.emit('CONSOLE', {
      level: 'warn',
      args
    });
  };

  console.error = (...args) => {
    messageBus.emit('CONSOLE', {
      level: 'error',
      args
    });
  };

  let relDest = path.relative(cwd, config.devOptions.out);

  if (!relDest.startsWith(`..${path.sep}`)) {
    relDest = `.${path.sep}` + relDest;
  }

  paint(messageBus, relevantWorkers, {
    dest: relDest
  }, undefined);

  if (!isBundled) {
    messageBus.emit('WORKER_UPDATE', {
      id: bundleWorker.id,
      state: ['SKIP', 'dim']
    });
  }

  for (const workerConfig of relevantWorkers) {
    const {
      id,
      type,
      match
    } = workerConfig;

    if (type !== 'run') {
      continue;
    }

    messageBus.emit('WORKER_UPDATE', {
      id,
      state: ['RUNNING', 'yellow']
    });
    const workerPromise = execa.command(workerConfig.cmd, {
      env: npmRunPath.env(),
      extendEnv: true,
      shell: true,
      cwd
    });
    workerPromise.catch(err => {
      messageBus.emit('WORKER_MSG', {
        id,
        level: 'error',
        msg: err.toString()
      });
      messageBus.emit('WORKER_COMPLETE', {
        id,
        error: err
      });
    });
    workerPromise.then(() => {
      messageBus.emit('WORKER_COMPLETE', {
        id,
        error: null
      });
    });
    const {
      stdout,
      stderr
    } = workerPromise;
    stdout === null || stdout === void 0 ? void 0 : stdout.on('data', b => {
      let stdOutput = b.toString();

      if (stdOutput.includes('\u001bc') || stdOutput.includes('\x1Bc')) {
        messageBus.emit('WORKER_RESET', {
          id
        });
        stdOutput = stdOutput.replace(/\x1Bc/, '').replace(/\u001bc/, '');
      }

      if (id.endsWith(':tsc')) {
        if (stdOutput.includes('\u001bc') || stdOutput.includes('\x1Bc')) {
          messageBus.emit('WORKER_UPDATE', {
            id,
            state: ['RUNNING', 'yellow']
          });
        }

        if (/Watching for file changes./gm.test(stdOutput)) {
          messageBus.emit('WORKER_UPDATE', {
            id,
            state: 'WATCHING'
          });
        }

        const errorMatch = stdOutput.match(/Found (\d+) error/);

        if (errorMatch && errorMatch[1] !== '0') {
          messageBus.emit('WORKER_UPDATE', {
            id,
            state: ['ERROR', 'red']
          });
        }
      }

      messageBus.emit('WORKER_MSG', {
        id,
        level: 'log',
        msg: stdOutput
      });
    });
    stderr === null || stderr === void 0 ? void 0 : stderr.on('data', b => {
      messageBus.emit('WORKER_MSG', {
        id,
        level: 'error',
        msg: b.toString()
      });
    });
    await workerPromise;
  } // Write the `import.meta.env` contents file to disk


  await fs.promises.writeFile(path.join(internalFilesBuildLoc, 'env.js'), generateEnvModule('production'));
  const mountDirDetails = relevantWorkers.map(scriptConfig => {
    const {
      id,
      type,
      args
    } = scriptConfig;

    if (type !== 'mount') {
      return false;
    }

    const dirDisk = path.resolve(cwd, args.fromDisk);
    const dirDest = path.resolve(buildDirectoryLoc, args.toUrl.replace(/^\//, ''));
    return [id, dirDisk, dirDest];
  }).filter(Boolean);
  const includeFileSets = [];
  const allProxiedFiles = new Set();
  const allCssModules = new Set();

  for (const [id, dirDisk, dirDest] of mountDirDetails) {
    messageBus.emit('WORKER_UPDATE', {
      id,
      state: ['RUNNING', 'yellow']
    });
    let allFiles;

    try {
      allFiles = glob.sync(`**/*`, {
        ignore: id === 'mount:web_modules' ? [] : config.exclude,
        cwd: dirDisk,
        absolute: true,
        nodir: true,
        dot: true
      });
      const allBuildNeededFiles = [];
      await Promise.all(allFiles.map(async f => {
        f = path.resolve(f); // this is necessary since glob.sync() returns paths with / on windows.  path.resolve() will switch them to the native path separator.

        if (!f.startsWith(commandOptions.config.installOptions.dest) && (allBuildExtensions.includes(path.extname(f).substr(1)) || path.extname(f) === '.jsx' || path.extname(f) === '.tsx' || path.extname(f) === '.ts' || path.extname(f) === '.js')) {
          allBuildNeededFiles.push(f);
          return;
        }

        const outPath = f.replace(dirDisk, dirDest);
        mkdirp.sync(path.dirname(outPath));
        return fs.promises.copyFile(f, outPath);
      }));
      includeFileSets.push([dirDisk, dirDest, allBuildNeededFiles]);
      messageBus.emit('WORKER_COMPLETE', {
        id
      });
    } catch (err) {
      messageBus.emit('WORKER_MSG', {
        id,
        level: 'error',
        msg: err.toString()
      });
      messageBus.emit('WORKER_COMPLETE', {
        id,
        error: err
      });
    }
  }

  const allBuiltFromFiles = new Set();

  for (const workerConfig of relevantWorkers) {
    const {
      id,
      match,
      type
    } = workerConfig;

    if (type !== 'build' || match.length === 0) {
      continue;
    }

    messageBus.emit('WORKER_UPDATE', {
      id,
      state: ['RUNNING', 'yellow']
    });

    for (const [dirDisk, dirDest, allFiles] of includeFileSets) {
      for (const f of allFiles) {
        const fileExtension = path.extname(f).substr(1);

        if (!match.includes(fileExtension)) {
          continue;
        }

        const fileContents = await fs.promises.readFile(f, {
          encoding: 'utf8'
        });
        let fileBuilder = getFileBuilderForWorker(cwd, workerConfig, messageBus);

        if (!fileBuilder) {
          continue;
        }

        let outPath = f.replace(dirDisk, dirDest);
        const extToFind = path.extname(f).substr(1);
        const extToReplace = srcFileExtensionMapping[extToFind];

        if (extToReplace) {
          outPath = outPath.replace(new RegExp(`${extToFind}$`), extToReplace);
        }

        const builtFile = await fileBuilder({
          contents: fileContents,
          filePath: f,
          isDev: false
        });

        if (!builtFile) {
          continue;
        }

        let {
          result: code,
          resources
        } = builtFile;
        const urlPath = outPath.substr(dirDest.length + 1);

        for (const plugin of config.plugins) {
          if (plugin.transform) {
            var _await$plugin$transfo;

            code = ((_await$plugin$transfo = await plugin.transform({
              contents: fileContents,
              urlPath,
              isDev: false
            })) === null || _await$plugin$transfo === void 0 ? void 0 : _await$plugin$transfo.result) || code;
          }
        }

        if (!code) {
          continue;
        }

        if (path.extname(outPath) === '.js') {
          if (resources === null || resources === void 0 ? void 0 : resources.css) {
            const cssOutPath = outPath.replace(/.js$/, '.css');
            await fs.promises.mkdir(path.dirname(cssOutPath), {
              recursive: true
            });
            await fs.promises.writeFile(cssOutPath, resources.css);
            code = `import './${path.basename(cssOutPath)}';\n` + code;
          }

          code = await transformEsmImports(code, spec => {
            if (spec.startsWith('http')) {
              return spec;
            }

            let mountScript = findMatchingMountScript(config.scripts, spec);

            if (mountScript) {
              let {
                fromDisk,
                toUrl
              } = mountScript.args;
              spec = spec.replace(fromDisk, toUrl);
            }

            if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
              const ext = path.extname(spec).substr(1);

              if (!ext) {
                if (isDirectoryImport(f, spec)) {
                  return spec + '/index.js';
                } else {
                  return spec + '.js';
                }
              }

              const extToReplace = srcFileExtensionMapping[ext];

              if (extToReplace) {
                spec = spec.replace(new RegExp(`${ext}$`), extToReplace);
              }

              if (spec.endsWith('.module.css')) {
                const resolvedUrl = path.resolve(path.dirname(outPath), spec);
                allCssModules.add(resolvedUrl);
                spec = spec.replace('.module.css', '.css.module.js');
              } else if (!isBundled && (extToReplace || ext) !== 'js') {
                const resolvedUrl = path.resolve(path.dirname(outPath), spec);
                allProxiedFiles.add(resolvedUrl);
                spec = spec + '.proxy.js';
              }

              return spec;
            }

            if (dependencyImportMap.imports[spec]) {
              let resolvedImport = path.posix.resolve(`/web_modules`, dependencyImportMap.imports[spec]);
              const extName = path.extname(resolvedImport);

              if (!isBundled && extName && extName !== '.js') {
                resolvedImport = resolvedImport + '.proxy.js';
              }

              return resolvedImport;
            }

            let [missingPackageName, ...deepPackagePathParts] = spec.split('/');

            if (missingPackageName.startsWith('@')) {
              missingPackageName += '/' + deepPackagePathParts.shift();
            }

            messageBus.emit('MISSING_WEB_MODULE', {
              id: f,
              data: {
                spec: spec,
                pkgName: missingPackageName
              }
            });
            return `/web_modules/${spec}.js`;
          });
          code = wrapImportMeta(code, {
            env: true,
            hmr: false
          });
        }

        await fs.promises.mkdir(path.dirname(outPath), {
          recursive: true
        });
        await fs.promises.writeFile(outPath, code);
        allBuiltFromFiles.add(f);
      }
    }

    messageBus.emit('WORKER_COMPLETE', {
      id,
      error: null
    });
  }

  stopEsbuild();

  for (const proxiedFileLoc of allCssModules) {
    const proxiedCode = await fs.promises.readFile(proxiedFileLoc, {
      encoding: 'utf8'
    });
    const proxiedExt = path.extname(proxiedFileLoc);
    const proxiedUrl = proxiedFileLoc.substr(buildDirectoryLoc.length);
    const proxyCode = await wrapCssModuleResponse(proxiedUrl, proxiedCode);
    const proxyFileLoc = proxiedFileLoc.replace('.module.css', '.css.module.js');
    await fs.promises.writeFile(proxyFileLoc, proxyCode, {
      encoding: 'utf8'
    });
  }

  for (const proxiedFileLoc of allProxiedFiles) {
    const proxiedCode = await fs.promises.readFile(proxiedFileLoc, {
      encoding: 'utf8'
    });
    const proxiedExt = path.extname(proxiedFileLoc);
    const proxiedUrl = proxiedFileLoc.substr(buildDirectoryLoc.length);
    const proxyCode = wrapEsmProxyResponse(proxiedUrl, proxiedCode, proxiedExt);
    const proxyFileLoc = proxiedFileLoc + '.proxy.js';
    await fs.promises.writeFile(proxyFileLoc, proxyCode, {
      encoding: 'utf8'
    });
  }

  if (!isBundled) {
    messageBus.emit('WORKER_COMPLETE', {
      id: bundleWorker.id,
      error: null
    });
    messageBus.emit('WORKER_UPDATE', {
      id: bundleWorker.id,
      state: ['SKIP', isBundledHardcoded ? 'dim' : 'yellow']
    });

    if (!isBundledHardcoded) {
      messageBus.emit('WORKER_MSG', {
        id: bundleWorker.id,
        level: 'log',
        msg: `"plugins": ["@snowpack/plugin-webpack"]\n\n` + `Connect a bundler plugin to optimize your build for production.\n` + chalk.dim(`Set "devOptions.bundle" configuration to false to remove this message.`)
      });
    }
  } else {
    try {
      var _bundleWorker;

      messageBus.emit('WORKER_UPDATE', {
        id: bundleWorker.id,
        state: ['RUNNING', 'yellow']
      });
      await ((_bundleWorker = bundleWorker) === null || _bundleWorker === void 0 ? void 0 : _bundleWorker.plugin.bundle({
        srcDirectory: buildDirectoryLoc,
        destDirectory: finalDirectoryLoc,
        jsFilePaths: allBuiltFromFiles,
        log: msg => {
          messageBus.emit('WORKER_MSG', {
            id: bundleWorker.id,
            level: 'log',
            msg
          });
        }
      }));
      messageBus.emit('WORKER_COMPLETE', {
        id: bundleWorker.id,
        error: null
      });
    } catch (err) {
      messageBus.emit('WORKER_MSG', {
        id: bundleWorker.id,
        level: 'error',
        msg: err.toString()
      });
      messageBus.emit('WORKER_COMPLETE', {
        id: bundleWorker.id,
        error: err
      });
    }
  }

  if (finalDirectoryLoc !== buildDirectoryLoc) {
    rimraf.sync(buildDirectoryLoc);
  }
}

class EsmHmrEngine {
  constructor(options = {}) {
    this.clients = new Set();
    this.dependencyTree = new Map();
    const wss = options.server ? new WebSocket.Server({
      noServer: true
    }) : new WebSocket.Server({
      port: 12321
    });

    if (options.server) {
      options.server.on('upgrade', (req, socket, head) => {
        // Only handle upgrades to ESM-HMR requests, ignore others.
        if (req.headers['sec-websocket-protocol'] !== 'esm-hmr') {
          return;
        }

        wss.handleUpgrade(req, socket, head, client => {
          wss.emit('connection', client, req);
        });
      });
    }

    wss.on('connection', client => {
      this.connectClient(client);
      this.registerListener(client);
    });
  }

  registerListener(client) {
    client.on('message', data => {
      const message = JSON.parse(data.toString());

      if (message.type === 'hotAccept') {
        const entry = this.getEntry(message.id, true);
        entry.isHmrAccepted = true;
      }
    });
  }

  createEntry(sourceUrl) {
    const newEntry = {
      dependencies: new Set(),
      dependents: new Set(),
      needsReplacement: false,
      isHmrEnabled: false,
      isHmrAccepted: false
    };
    this.dependencyTree.set(sourceUrl, newEntry);
    return newEntry;
  }

  getEntry(sourceUrl, createIfNotFound = false) {
    const result = this.dependencyTree.get(sourceUrl);

    if (result) {
      return result;
    }

    if (createIfNotFound) {
      return this.createEntry(sourceUrl);
    }

    return null;
  }

  setEntry(sourceUrl, imports, isHmrEnabled = false) {
    const result = this.getEntry(sourceUrl, true);
    const outdatedDependencies = new Set(result.dependencies);
    result.isHmrEnabled = isHmrEnabled;

    for (const importUrl of imports) {
      this.addRelationship(sourceUrl, importUrl);
      outdatedDependencies.delete(importUrl);
    }

    for (const importUrl of outdatedDependencies) {
      this.removeRelationship(sourceUrl, importUrl);
    }
  }

  removeRelationship(sourceUrl, importUrl) {
    let importResult = this.getEntry(importUrl);
    importResult && importResult.dependents.delete(sourceUrl);
    const sourceResult = this.getEntry(sourceUrl);
    sourceResult && sourceResult.dependencies.delete(importUrl);
  }

  addRelationship(sourceUrl, importUrl) {
    if (importUrl !== sourceUrl) {
      let importResult = this.getEntry(importUrl, true);
      importResult.dependents.add(sourceUrl);
      const sourceResult = this.getEntry(sourceUrl, true);
      sourceResult.dependencies.add(importUrl);
    }
  }

  markEntryForReplacement(entry, state) {
    entry.needsReplacement = state;
  }

  broadcastMessage(data) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      } else {
        this.disconnectClient(client);
      }
    });
  }

  connectClient(client) {
    this.clients.add(client);
  }

  disconnectClient(client) {
    client.terminate();
    this.clients.delete(client);
  }

  disconnectAllClients() {
    for (const client of this.clients) {
      this.disconnectClient(client);
    }
  }

}

/**
 * This license applies to parts of this file originating from the
 * https://github.com/lukejacksonn/servor repository:
 *
 * MIT License
 * Copyright (c) 2019 Luke Jackson
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const HMR_DEV_CODE = fs.readFileSync(path.join(__dirname, '../assets/hmr.js'));

const DEFAULT_PROXY_ERROR_HANDLER = (err, req, res) => {
  const reqUrl = req.url;
  console.error(`✘ ${reqUrl}\n${err.message}`);
  sendError(res, 502);
};

function shouldProxy(pathPrefix, req) {
  const reqPath = decodeURI(url.parse(req.url).pathname);
  return reqPath.startsWith(pathPrefix);
}

function getEncodingType(ext) {
  if (ext === '.js' || ext === '.css' || ext === '.html') {
    return 'utf-8';
  } else {
    return 'binary';
  }
}

const sendFile = (req, res, body, ext = '.html') => {
  var _req$headers$cacheCo;

  const ETag = etag(body);
  const headers = {
    'Content-Type': mime.contentType(ext) || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    ETag,
    Vary: 'Accept-Encoding'
  };

  if (req.headers['if-none-match'] === ETag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  let acceptEncoding = req.headers['accept-encoding'] || '';

  if (((_req$headers$cacheCo = req.headers['cache-control']) === null || _req$headers$cacheCo === void 0 ? void 0 : _req$headers$cacheCo.includes('no-transform')) || ['HEAD', 'OPTIONS'].includes(req.method) || !isCompressible(mime.contentType(ext))) {
    acceptEncoding = '';
  }

  function onError(err) {
    if (err) {
      res.end();
      console.error(chalk.red(`  ✘ An error occurred while compressing ${chalk.bold(req.url)}`), err);
    }
  }

  if (/\bgzip\b/.test(acceptEncoding) && stream.Readable.from) {
    const bodyStream = stream.Readable.from([body]);
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    stream.pipeline(bodyStream, zlib.createGzip(), res, onError);
    return;
  }

  res.writeHead(200, headers);
  res.write(body, getEncodingType(ext));
  res.end();
};

const sendError = (res, status) => {
  res.writeHead(status);
  res.end();
};

function getUrlFromFile(mountedDirectories, fileLoc) {
  for (const [dirDisk, dirUrl] of mountedDirectories) {
    if (fileLoc.startsWith(dirDisk + path.sep)) {
      const fileExt = path.extname(fileLoc).substr(1);
      const resolvedDirUrl = dirUrl === '/' ? '' : dirUrl;
      return fileLoc.replace(dirDisk, resolvedDirUrl).replace(/[/\\]+/g, '/').replace(new RegExp(`${fileExt}$`), srcFileExtensionMapping[fileExt] || fileExt);
    }
  }

  return null;
}

function getMountedDirectory(cwd, workerConfig) {
  const {
    args
  } = workerConfig;
  return [path.resolve(cwd, args.fromDisk), args.toUrl];
}

let currentlyRunningCommand = null;
async function command$2(commandOptions) {
  let serverStart = Date.now();
  const {
    cwd,
    config
  } = commandOptions;
  const {
    port,
    open
  } = config.devOptions;
  const inMemoryBuildCache = new Map();
  const inMemoryResourceCache = new Map();
  const filesBeingDeleted = new Set();
  const filesBeingBuilt = new Map();
  const messageBus = new events.EventEmitter();
  const mountedDirectories = []; // Check whether the port is available

  const availablePort = await detectPort(port);
  const isPortAvailable = port === availablePort;

  if (!isPortAvailable) {
    console.error();
    console.error(chalk.red(`  ✘ port ${chalk.bold(port)} is not available. use ${chalk.bold('--port')} to specify a different port.`));
    console.error();
    process.exit(1);
  } // Set the proper install options, in case an install is needed.


  commandOptions.config.installOptions.dest = DEV_DEPENDENCIES_DIR;
  commandOptions.config.installOptions.env.NODE_ENV = process.env.NODE_ENV || 'development';
  const dependencyImportMapLoc = path.join(config.installOptions.dest, 'import-map.json'); // Start with a fresh install of your dependencies, if needed.

  if (!(await checkLockfileHash(DEV_DEPENDENCIES_DIR)) || !fs.existsSync(dependencyImportMapLoc)) {
    console.log(chalk.yellow('! updating dependencies...'));
    await command(commandOptions);
    await updateLockfileHash(DEV_DEPENDENCIES_DIR);
    serverStart = Date.now();
  }

  let dependencyImportMap = {
    imports: {}
  };

  try {
    dependencyImportMap = JSON.parse(await fs.promises.readFile(dependencyImportMapLoc, {
      encoding: 'utf-8'
    }));
  } catch (err) {// no import-map found, safe to ignore
  }

  async function buildFile(fileContents, fileLoc, reqPath, fileBuilder) {
    let builtFileResult;
    let fileBuilderPromise = filesBeingBuilt.get(fileLoc);

    if (fileBuilderPromise) {
      builtFileResult = await fileBuilderPromise;
    } else {
      fileBuilderPromise = (async () => {
        let _builtFileResult = {
          result: fileContents
        };

        if (fileBuilder) {
          _builtFileResult = (await fileBuilder({
            contents: fileContents,
            filePath: fileLoc,
            isDev: true
          })) || _builtFileResult;
        }

        for (const plugin of config.plugins) {
          if (plugin.transform) {
            var _await$plugin$transfo;

            _builtFileResult.result = ((_await$plugin$transfo = await plugin.transform({
              contents: _builtFileResult.result,
              urlPath: reqPath,
              isDev: true
            })) === null || _await$plugin$transfo === void 0 ? void 0 : _await$plugin$transfo.result) || _builtFileResult.result;
          }
        }

        return _builtFileResult;
      })();

      try {
        filesBeingBuilt.set(fileLoc, fileBuilderPromise);
        builtFileResult = await fileBuilderPromise;
      } finally {
        filesBeingBuilt.delete(fileLoc);
      }
    }

    const ext = path.extname(fileLoc).substr(1);

    if (ext === 'js' || srcFileExtensionMapping[ext] === 'js') {
      let missingWebModule = null;
      builtFileResult.result = await transformEsmImports(builtFileResult.result, spec => {
        if (spec.startsWith('http')) {
          return spec;
        }

        let mountScript = findMatchingMountScript(config.scripts, spec);

        if (mountScript) {
          let {
            fromDisk,
            toUrl
          } = mountScript.args;
          spec = spec.replace(fromDisk, toUrl);
        }

        if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
          const ext = path.extname(spec).substr(1);

          if (!ext) {
            if (isDirectoryImport(fileLoc, spec)) {
              return spec + '/index.js';
            } else {
              return spec + '.js';
            }
          }

          const extToReplace = srcFileExtensionMapping[ext];

          if (extToReplace) {
            spec = spec.replace(new RegExp(`${ext}$`), extToReplace);
          }

          if (!spec.endsWith('.module.css') && (extToReplace || ext) !== 'js') {
            spec = spec + '.proxy.js';
          }

          return spec;
        }

        if (dependencyImportMap.imports[spec]) {
          let resolvedImport = path.posix.resolve(`/web_modules`, dependencyImportMap.imports[spec]);
          const extName = path.extname(resolvedImport);

          if (extName && extName !== '.js') {
            resolvedImport = resolvedImport + '.proxy.js';
          }

          return resolvedImport;
        }

        let [missingPackageName, ...deepPackagePathParts] = spec.split('/');

        if (missingPackageName.startsWith('@')) {
          missingPackageName += '/' + deepPackagePathParts.shift();
        }

        const [depManifestLoc] = resolveDependencyManifest(missingPackageName, cwd);
        const doesPackageExist = !!depManifestLoc;

        if (doesPackageExist && !currentlyRunningCommand) {
          isLiveReloadPaused = true;
          messageBus.emit('INSTALLING');
          currentlyRunningCommand = command(commandOptions);
          currentlyRunningCommand.then(async () => {
            dependencyImportMap = JSON.parse(await fs.promises.readFile(dependencyImportMapLoc, {
              encoding: 'utf-8'
            }).catch(() => `{"imports": {}}`));
            await updateLockfileHash(DEV_DEPENDENCIES_DIR);
            await cacache.rm.all(BUILD_CACHE);
            inMemoryBuildCache.clear();
            messageBus.emit('INSTALL_COMPLETE');
            isLiveReloadPaused = false;
            currentlyRunningCommand = null;
          });
        } else if (!doesPackageExist) {
          missingWebModule = {
            spec: spec,
            pkgName: missingPackageName
          };
        }

        const extName = path.extname(spec);

        if (extName && extName !== '.js') {
          spec = spec + '.proxy';
        }

        return `/web_modules/${spec}.js`;
      });
      messageBus.emit('MISSING_WEB_MODULE', {
        id: fileLoc,
        data: missingWebModule
      });
    }

    return builtFileResult;
  }

  function runLintAll(workerConfig) {
    let {
      id,
      cmd,
      watch: watchCmd
    } = workerConfig;
    const workerPromise = execa.command(watchCmd || cmd, {
      env: npmRunPath.env(),
      extendEnv: true,
      shell: true,
      cwd
    });
    const {
      stdout,
      stderr
    } = workerPromise;
    stdout === null || stdout === void 0 ? void 0 : stdout.on('data', b => {
      let stdOutput = b.toString();

      if (stdOutput.includes('\u001bc') || stdOutput.includes('\x1Bc')) {
        messageBus.emit('WORKER_RESET', {
          id
        });
        stdOutput = stdOutput.replace(/\x1Bc/, '').replace(/\u001bc/, '');
      }

      if (id.endsWith(':tsc')) {
        if (stdOutput.includes('\u001bc') || stdOutput.includes('\x1Bc')) {
          messageBus.emit('WORKER_UPDATE', {
            id,
            state: ['RUNNING', 'yellow']
          });
        }

        if (/Watching for file changes./gm.test(stdOutput)) {
          messageBus.emit('WORKER_UPDATE', {
            id,
            state: 'WATCH'
          });
        }

        const errorMatch = stdOutput.match(/Found (\d+) error/);

        if (errorMatch && errorMatch[1] !== '0') {
          messageBus.emit('WORKER_UPDATE', {
            id,
            state: ['ERROR', 'red']
          });
        }
      }

      messageBus.emit('WORKER_MSG', {
        id,
        level: 'log',
        msg: stdOutput
      });
    });
    stderr === null || stderr === void 0 ? void 0 : stderr.on('data', b => {
      messageBus.emit('WORKER_MSG', {
        id,
        level: 'error',
        msg: b.toString()
      });
    });
    workerPromise.catch(err => {
      messageBus.emit('WORKER_COMPLETE', {
        id,
        error: err
      });
    });
    workerPromise.then(() => {
      messageBus.emit('WORKER_COMPLETE', {
        id,
        error: null
      });
    });
  }

  for (const workerConfig of config.scripts) {
    if (workerConfig.type === 'run') {
      runLintAll(workerConfig);
    }

    if (workerConfig.type === 'mount') {
      mountedDirectories.push(getMountedDirectory(cwd, workerConfig));
      setTimeout(() => messageBus.emit('WORKER_UPDATE', {
        id: workerConfig.id,
        state: ['DONE', 'green']
      }), 400);
    }
  }

  const devProxies = {};
  config.proxy.forEach(([pathPrefix, proxyOptions]) => {
    const proxyServer = devProxies[pathPrefix] = HttpProxy.createProxyServer(proxyOptions);

    for (const [onEventName, eventHandler] of Object.entries(proxyOptions.on)) {
      proxyServer.on(onEventName, eventHandler);
    }

    if (!proxyOptions.on.error) {
      proxyServer.on('error', DEFAULT_PROXY_ERROR_HANDLER);
    }
  });
  const server = http.createServer(async (req, res) => {
    var _finalBuild$resources, _finalBuild$resources2;

    const reqUrl = req.url;
    let reqPath = decodeURI(url.parse(reqUrl).pathname);
    const originalReqPath = reqPath;
    let isProxyModule = false;
    let isCssModule = false;

    if (reqPath.endsWith('.proxy.js')) {
      isProxyModule = true;
      reqPath = reqPath.replace('.proxy.js', '');
    }

    if (reqPath.endsWith('.module.css')) {
      isCssModule = true;
    } // const requestStart = Date.now();


    res.on('finish', () => {
      const {
        method,
        url
      } = req;
      const {
        statusCode
      } = res;

      if (statusCode !== 200) {
        messageBus.emit('SERVER_RESPONSE', {
          method,
          url,
          statusCode
        });
      }
    });

    if (reqPath === '/__snowpack__/hmr.js') {
      sendFile(req, res, HMR_DEV_CODE, '.js');
      return;
    }

    if (reqPath === '/__snowpack__/env.js') {
      sendFile(req, res, generateEnvModule('development'), '.js');
      return;
    }

    for (const [pathPrefix] of config.proxy) {
      if (!shouldProxy(pathPrefix, req)) {
        continue;
      }

      devProxies[pathPrefix].web(req, res);
      return;
    }

    const attemptedFileLoads = [];

    function attemptLoadFile(requestedFile) {
      if (attemptedFileLoads.includes(requestedFile)) {
        return Promise.resolve(null);
      }

      attemptedFileLoads.push(requestedFile);
      return fs.promises.stat(requestedFile).then(stat => stat.isFile() ? requestedFile : null).catch(() => null
        /* ignore */
      );
    }

    let requestedFileExt = path.parse(reqPath).ext.toLowerCase();
    let responseFileExt = requestedFileExt;
    let fileBuilder;
    let isRoute = !requestedFileExt; // Now that we've set isRoute properly, give `requestedFileExt` a fallback

    requestedFileExt = requestedFileExt || '.html';

    async function getFileFromUrl(reqPath) {
      for (const [dirDisk, dirUrl] of mountedDirectories) {
        let requestedFile;

        if (dirUrl === '/') {
          requestedFile = path.join(dirDisk, reqPath);
        } else if (reqPath.startsWith(dirUrl)) {
          requestedFile = path.join(dirDisk, reqPath.replace(dirUrl, './'));
        } else {
          continue;
        }

        if (requestedFile.startsWith(commandOptions.config.installOptions.dest)) {
          const fileLoc = await attemptLoadFile(requestedFile);

          if (fileLoc) {
            return [fileLoc, null];
          }
        }

        if (isRoute) {
          let fileLoc = (await attemptLoadFile(requestedFile + '.html')) || (await attemptLoadFile(requestedFile + 'index.html')) || (await attemptLoadFile(requestedFile + '/index.html'));

          if (!fileLoc && dirUrl === '/' && config.devOptions.fallback) {
            const fallbackFile = path.join(dirDisk, config.devOptions.fallback);
            fileLoc = await attemptLoadFile(fallbackFile);
          }

          if (fileLoc) {
            responseFileExt = '.html';
            return [fileLoc, null];
          }
        } else {
          for (const workerConfig of config.scripts) {
            const {
              type,
              match
            } = workerConfig;

            if (type !== 'build') {
              continue;
            }

            for (const extMatcher of match) {
              if (extMatcher === requestedFileExt.substr(1) || srcFileExtensionMapping[extMatcher] === requestedFileExt.substr(1)) {
                const srcFile = requestedFile.replace(requestedFileExt, `.${extMatcher}`);
                const fileLoc = await attemptLoadFile(srcFile);

                if (fileLoc) {
                  return [fileLoc, workerConfig];
                }
              }
            }
          }

          const fileLoc = (await attemptLoadFile(requestedFile)) || (await attemptLoadFile(requestedFile.replace(/\.js$/, '.jsx'))) || (await attemptLoadFile(requestedFile.replace(/\.js$/, '.ts'))) || (await attemptLoadFile(requestedFile.replace(/\.js$/, '.tsx')));

          if (fileLoc) {
            return [fileLoc, null];
          }
        }
      }

      return [null, null];
    } // 0. Check if the request is for a virtual sub-resource. These are populated by some
    // builders when a file compiles to multiple files. For example, Svelte & Vue files
    // compile to a main JS file + related CSS to import with the JS.


    let virtualResourceResponse = inMemoryResourceCache.get(reqPath);

    if (virtualResourceResponse) {
      if (isProxyModule) {
        responseFileExt = '.js';
        virtualResourceResponse = wrapEsmProxyResponse(reqPath, virtualResourceResponse, requestedFileExt, true);
      }

      sendFile(req, res, virtualResourceResponse, responseFileExt);
      return;
    }

    const [fileLoc, selectedWorker] = await getFileFromUrl(reqPath);

    if (isRoute) {
      messageBus.emit('NEW_SESSION');
    }

    if (!fileLoc) {
      const prefix = chalk.red('  ✘ ');
      console.error(`[404] ${reqUrl}\n${attemptedFileLoads.map(loc => prefix + loc).join('\n')}`);
      return sendError(res, 404);
    }

    if (selectedWorker) {
      fileBuilder = getFileBuilderForWorker(cwd, selectedWorker, messageBus);
    }

    async function wrapResponse(code, cssResource) {
      if (isRoute) {
        code = wrapHtmlResponse(code, true);
      } else if (isProxyModule) {
        responseFileExt = '.js';
        code = wrapEsmProxyResponse(reqPath, code, requestedFileExt, true);
      } else if (isCssModule) {
        responseFileExt = '.js';
        code = await wrapCssModuleResponse(reqPath, code, requestedFileExt, true);
      } else if (responseFileExt === '.js') {
        code = wrapImportMeta(code, {
          env: true,
          hmr: true
        });
      }

      if (responseFileExt === '.js' && cssResource) {
        code = `import './${path.basename(reqPath).replace(/.js$/, '.css.proxy.js')}';\n` + code;
      }

      return code;
    } // 1. Check the hot build cache. If it's already found, then just serve it.


    let hotCachedResponse = inMemoryBuildCache.get(fileLoc);

    if (hotCachedResponse) {
      hotCachedResponse = hotCachedResponse.toString(getEncodingType(requestedFileExt));
      const isHot = reqUrl.includes('?mtime=');

      if (isHot) {
        const [, mtime] = reqUrl.split('?');
        hotCachedResponse = await transformEsmImports(hotCachedResponse, imp => {
          const importUrl = path.posix.resolve(path.posix.dirname(reqPath), imp);
          const node = hmrEngine.getEntry(importUrl);

          if (node && node.needsReplacement) {
            hmrEngine.markEntryForReplacement(node, false);
            return `${imp}?${mtime}`;
          }

          return imp;
        });
      }

      const wrappedResponse = await wrapResponse(hotCachedResponse, inMemoryResourceCache.get(reqPath.replace(/.js$/, '.css')));
      sendFile(req, res, wrappedResponse, responseFileExt);
      return;
    } // 2. Load the file from disk. We'll need it to check the cold cache or build from scratch.


    let fileContents;

    try {
      fileContents = await fs.promises.readFile(fileLoc, getEncodingType(requestedFileExt));
    } catch (err) {
      console.error(fileLoc, err);
      return sendError(res, 500);
    } // 3. Check the persistent cache. If found, serve it via a "trust-but-verify" strategy.
    // Build it after sending, and if it no longer matches then assume the entire cache is suspect.
    // In that case, clear the persistent cache and then force a live-reload of the page.


    const cachedBuildData = !filesBeingDeleted.has(fileLoc) && (await cacache.get(BUILD_CACHE, fileLoc).catch(() => null));

    if (cachedBuildData) {
      const {
        originalFileHash,
        resources
      } = cachedBuildData.metadata;
      const newFileHash = etag(fileContents);

      if (originalFileHash === newFileHash) {
        const coldCachedResponse = cachedBuildData.data;
        inMemoryBuildCache.set(fileLoc, coldCachedResponse);

        if (resources === null || resources === void 0 ? void 0 : resources.css) {
          inMemoryResourceCache.set(reqPath.replace(/.js$/, '.css'), resources.css);
        } // Trust...


        const wrappedResponse = await wrapResponse(coldCachedResponse.toString(getEncodingType(requestedFileExt)), resources === null || resources === void 0 ? void 0 : resources.css);

        if (responseFileExt === '.js') {
          const isHmrEnabled = wrappedResponse.includes('import.meta.hot');
          const rawImports = await scanCodeImportsExports(wrappedResponse);
          const resolvedImports = rawImports.map(imp => {
            let spec = wrappedResponse.substring(imp.s, imp.e);

            if (imp.d > -1) {
              const importSpecifierMatch = spec.match(/^\s*['"](.*)['"]\s*$/m);
              spec = importSpecifierMatch[1];
            }

            return path.posix.resolve(path.posix.dirname(reqPath), spec);
          });
          hmrEngine.setEntry(originalReqPath, resolvedImports, isHmrEnabled);
        }

        sendFile(req, res, wrappedResponse, responseFileExt); // ...but verify.

        let checkFinalBuildResult = null;
        let checkFinalBuildCss = null;

        try {
          var _checkFinalBuildAnywa;

          const checkFinalBuildAnyway = await buildFile(fileContents, fileLoc, reqPath, fileBuilder);
          checkFinalBuildResult = checkFinalBuildAnyway && checkFinalBuildAnyway.result;
          checkFinalBuildCss = checkFinalBuildAnyway && ((_checkFinalBuildAnywa = checkFinalBuildAnyway.resources) === null || _checkFinalBuildAnywa === void 0 ? void 0 : _checkFinalBuildAnywa.css);
        } catch (err) {// safe to ignore, it will be surfaced later anyway
        } finally {
          if (checkFinalBuildCss !== (resources === null || resources === void 0 ? void 0 : resources.css) || !checkFinalBuildResult || !coldCachedResponse.equals(Buffer.from(checkFinalBuildResult, getEncodingType(requestedFileExt)))) {
            inMemoryBuildCache.clear();
            await cacache.rm.all(BUILD_CACHE);
            hmrEngine.broadcastMessage({
              type: 'reload'
            });
          }
        }

        return;
      }
    } // 4. Final option: build the file, serve it, and cache it.


    let finalBuild;

    try {
      finalBuild = await buildFile(fileContents, fileLoc, reqPath, fileBuilder);
    } catch (err) {
      console.error(fileLoc, err);
    }

    if (!finalBuild || finalBuild.result === '') {
      return sendError(res, 500);
    }

    inMemoryBuildCache.set(fileLoc, Buffer.from(finalBuild.result, getEncodingType(requestedFileExt)));

    if ((_finalBuild$resources = finalBuild.resources) === null || _finalBuild$resources === void 0 ? void 0 : _finalBuild$resources.css) {
      inMemoryResourceCache.set(reqPath.replace(/.js$/, `.css`), finalBuild.resources.css);
    }

    const originalFileHash = etag(fileContents);
    cacache.put(BUILD_CACHE, fileLoc, Buffer.from(finalBuild.result, getEncodingType(requestedFileExt)), {
      metadata: {
        originalFileHash,
        resources: finalBuild.resources
      }
    });
    const wrappedResponse = await wrapResponse(finalBuild.result, (_finalBuild$resources2 = finalBuild.resources) === null || _finalBuild$resources2 === void 0 ? void 0 : _finalBuild$resources2.css);

    if (responseFileExt === '.js') {
      const isHmrEnabled = wrappedResponse.includes('import.meta.hot');
      const rawImports = await scanCodeImportsExports(wrappedResponse);
      const resolvedImports = rawImports.map(imp => {
        let spec = wrappedResponse.substring(imp.s, imp.e);

        if (imp.d > -1) {
          const importSpecifierMatch = spec.match(/^\s*['"](.*)['"]\s*$/m);
          spec = importSpecifierMatch[1];
        }

        return path.posix.resolve(path.posix.dirname(reqPath), spec);
      });
      hmrEngine.setEntry(originalReqPath, resolvedImports, isHmrEnabled);
    }

    sendFile(req, res, wrappedResponse, responseFileExt);
  }).on('upgrade', (req, socket, head) => {
    config.proxy.forEach(([pathPrefix, proxyOptions]) => {
      var _proxyOptions$target;

      const isWebSocket = proxyOptions.ws || ((_proxyOptions$target = proxyOptions.target) === null || _proxyOptions$target === void 0 ? void 0 : _proxyOptions$target.toString().startsWith('ws'));

      if (isWebSocket && shouldProxy(pathPrefix, req)) {
        devProxies[pathPrefix].ws(req, socket, head);
        console.log('Upgrading to WebSocket');
      }
    });
  }).listen(port);
  const hmrEngine = new EsmHmrEngine({
    server
  }); // Live Reload + File System Watching

  let isLiveReloadPaused = false;

  function updateOrBubble(url, visited) {
    if (visited.has(url)) {
      return;
    }

    visited.add(url);
    const node = hmrEngine.getEntry(url);

    if (node && node.isHmrEnabled) {
      hmrEngine.broadcastMessage({
        type: 'update',
        url
      });
    }

    if (node && node.isHmrAccepted); else if (node && node.dependents.size > 0) {
      hmrEngine.markEntryForReplacement(node, true);
      node.dependents.forEach(dep => updateOrBubble(dep, visited));
    } else {
      // We've reached the top, trigger a full page refresh
      hmrEngine.broadcastMessage({
        type: 'reload'
      });
    }
  }

  async function onWatchEvent(fileLoc) {
    let updateUrl = getUrlFromFile(mountedDirectories, fileLoc);
    let isNotjs = false
    if (updateUrl) {
      if (!updateUrl.endsWith('.js')) {
        updateUrl += '.proxy.js';
      }

      if (isLiveReloadPaused) {
        return;
      } // If no entry exists, file has never been loaded, safe to ignore

      // updateOrBubble(updateUrl, new Set());
      // if (isNotjs) {
      //   updateOrBubble(updateUrl, new Set());
      // }
      updateOrBubble(updateUrl, new Set());
      // if (hmrEngine.getEntry(updateUrl)) {
      //   updateOrBubble(updateUrl, new Set());
      // }
    }

    inMemoryBuildCache.delete(fileLoc);
    filesBeingDeleted.add(fileLoc);
    await cacache.rm.entry(BUILD_CACHE, fileLoc);
    filesBeingDeleted.delete(fileLoc);
  }

  const watcher = chokidar.watch(mountedDirectories.map(([dirDisk]) => dirDisk), {
    ignored: config.exclude,
    persistent: true,
    ignoreInitial: true,
    disableGlobbing: false
  });
  watcher.on('add', fileLoc => onWatchEvent(fileLoc));
  watcher.on('change', fileLoc => onWatchEvent(fileLoc));
  watcher.on('unlink', fileLoc => onWatchEvent(fileLoc));
  onProcessExit(() => {
    hmrEngine.disconnectAllClients();
  });

  console.log = (...args) => {
    messageBus.emit('CONSOLE', {
      level: 'log',
      args
    });
  };

  console.warn = (...args) => {
    messageBus.emit('CONSOLE', {
      level: 'warn',
      args
    });
  };

  console.error = (...args) => {
    messageBus.emit('CONSOLE', {
      level: 'error',
      args
    });
  };

  const ips = Object.values(os.networkInterfaces()).reduce((every, i) => [...every, ...(i || [])], []).filter(i => i.family === 'IPv4' && i.internal === false).map(i => i.address);
  paint(messageBus, config.scripts, undefined, {
    port,
    ips,
    startTimeMs: Date.now() - serverStart,
    addPackage: async pkgName => {
      isLiveReloadPaused = true;
      messageBus.emit('INSTALLING');
      currentlyRunningCommand = execa(isYarn(cwd) ? 'yarn' : 'npm', isYarn(cwd) ? ['add', pkgName] : ['install', '--save', pkgName], {
        env: npmRunPath.env(),
        extendEnv: true,
        shell: true,
        cwd
      });
      currentlyRunningCommand.stdout.on('data', data => process.stdout.write(data));
      currentlyRunningCommand.stderr.on('data', data => process.stderr.write(data));
      await currentlyRunningCommand;
      currentlyRunningCommand = command(commandOptions);
      await currentlyRunningCommand;
      await updateLockfileHash(DEV_DEPENDENCIES_DIR);
      await cacache.rm.all(BUILD_CACHE);
      inMemoryBuildCache.clear();
      currentlyRunningCommand = null;
      dependencyImportMap = JSON.parse(await fs.promises.readFile(dependencyImportMapLoc, {
        encoding: 'utf-8'
      }).catch(() => `{"imports": {}}`));
      messageBus.emit('INSTALL_COMPLETE');
      isLiveReloadPaused = false;
    }
  });
  if (open !== 'none') await openInBrowser(port, open);
  return new Promise(() => { });
}

async function addCommand(addValue, commandOptions) {
  const {
    cwd,
    config,
    pkgManifest
  } = commandOptions;
  let [pkgName, pkgSemver] = addValue.split('@');

  if (!pkgSemver) {
    const body = await got(`http://registry.npmjs.org/${pkgName}/latest`).json();
    pkgSemver = `^${body.version}`;
  }

  pkgManifest.webDependencies = pkgManifest.webDependencies || {};
  pkgManifest.webDependencies[pkgName] = pkgSemver;
  config.webDependencies = config.webDependencies || {};
  config.webDependencies[pkgName] = pkgSemver;
  await fs.promises.writeFile(path.join(cwd, 'package.json'), JSON.stringify(pkgManifest, null, 2));
  await command(commandOptions);
}
async function rmCommand(addValue, commandOptions) {
  const {
    cwd,
    config,
    pkgManifest
  } = commandOptions;
  let [pkgName] = addValue.split('@');
  pkgManifest.webDependencies = pkgManifest.webDependencies || {};
  delete pkgManifest.webDependencies[pkgName];
  config.webDependencies = config.webDependencies || {};
  delete config.webDependencies[pkgName];
  await fs.promises.writeFile(path.join(cwd, 'package.json'), JSON.stringify(pkgManifest, null, 2));
  await command(commandOptions);
}

const CONFIG_NAME = 'snowpack';
const ALWAYS_EXCLUDE = ['**/node_modules/**/*', '**/.types/**/*'];
const SCRIPT_TYPES_WEIGHTED = {
  proxy: 1,
  mount: 2,
  run: 3,
  build: 4,
  bundle: 100
}; // default settings

const DEFAULT_CONFIG = {
  exclude: ['__tests__/**/*', '**/*.@(spec|test).*'],
  plugins: [],
  installOptions: {
    dest: 'web_modules',
    externalPackage: [],
    installTypes: false,
    env: {},
    alias: {},
    rollup: {
      plugins: [],
      dedupe: []
    }
  },
  devOptions: {
    port: 8080,
    open: 'default',
    out: 'build',
    fallback: 'index.html',
    bundle: undefined
  }
};
const configSchema = {
  type: 'object',
  properties: {
    extends: {
      type: 'string'
    },
    install: {
      type: 'array',
      items: {
        type: 'string'
      }
    },
    exclude: {
      type: 'array',
      items: {
        type: 'string'
      }
    },
    plugins: {
      type: 'array'
    },
    webDependencies: {
      type: ['object'],
      additionalProperties: {
        type: 'string'
      }
    },
    scripts: {
      type: ['object'],
      additionalProperties: {
        type: 'string'
      }
    },
    devOptions: {
      type: 'object',
      properties: {
        port: {
          type: 'number'
        },
        out: {
          type: 'string'
        },
        fallback: {
          type: 'string'
        },
        bundle: {
          type: 'boolean'
        },
        open: {
          type: 'string'
        }
      }
    },
    installOptions: {
      type: 'object',
      properties: {
        dest: {
          type: 'string'
        },
        externalPackage: {
          type: 'array',
          items: {
            type: 'string'
          }
        },
        installTypes: {
          type: 'boolean'
        },
        sourceMap: {
          oneOf: [{
            type: 'boolean'
          }, {
            type: 'string'
          }]
        },
        alias: {
          type: 'object',
          additionalProperties: {
            type: 'string'
          }
        },
        env: {
          type: 'object',
          additionalProperties: {
            oneOf: [{
              id: 'EnvVarString',
              type: 'string'
            }, {
              id: 'EnvVarNumber',
              type: 'number'
            }, {
              id: 'EnvVarTrue',
              type: 'boolean',
              enum: [true]
            }]
          }
        },
        rollup: {
          type: 'object',
          properties: {
            plugins: {
              type: 'array',
              items: {
                type: 'object'
              }
            },
            dedupe: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            namedExports: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                items: {
                  type: 'string'
                }
              }
            }
          }
        }
      }
    },
    proxy: {
      type: 'object'
    }
  }
};
/**
 * Convert CLI flags to an incomplete Snowpack config representation.
 * We need to be careful about setting properties here if the flag value
 * is undefined, since the deep merge strategy would then overwrite good
 * defaults with 'undefined'.
 */

function expandCliFlags(flags) {
  const result = {
    installOptions: {},
    devOptions: {}
  };

  const relevantFlags = _objectWithoutProperties(flags, ["help", "version", "reload", "config"]);

  for (const [flag, val] of Object.entries(relevantFlags)) {
    if (flag === '_' || flag.includes('-')) {
      continue;
    }

    if (configSchema.properties[flag]) {
      result[flag] = val;
      continue;
    }

    if (configSchema.properties.installOptions.properties[flag]) {
      result.installOptions[flag] = val;
      continue;
    }

    if (configSchema.properties.devOptions.properties[flag]) {
      result.devOptions[flag] = val;
      continue;
    }

    console.error(`Unknown CLI flag: "${flag}"`);
    process.exit(1);
  }

  if (result.installOptions.env) {
    result.installOptions.env = result.installOptions.env.reduce((acc, id) => {
      const index = id.indexOf('=');
      const [key, val] = index > 0 ? [id.substr(0, index), id.substr(index + 1)] : [id, true];
      acc[key] = val;
      return acc;
    }, {});
  }

  return result;
}
/**
 * Convert deprecated proxy scripts to
 * FUTURE: Remove this on next major release
 */


function handleLegacyProxyScripts(config) {
  for (const scriptId in config.scripts) {
    if (!scriptId.startsWith('proxy:')) {
      continue;
    }

    const cmdArr = config.scripts[scriptId].split(/\s+/);

    if (cmdArr[0] !== 'proxy') {
      handleConfigError(`scripts[${scriptId}] must use the proxy command`);
    }

    cmdArr.shift();
    const {
      to,
      _
    } = yargs(cmdArr);

    if (_.length !== 1) {
      handleConfigError(`scripts[${scriptId}] must use the format: "proxy http://SOME.URL --to /PATH"`);
    }

    if (to && to[0] !== '/') {
      handleConfigError(`scripts[${scriptId}]: "--to ${to}" must be a URL path, and start with a "/"`);
    }

    const {
      toUrl,
      fromUrl
    } = {
      fromUrl: _[0],
      toUrl: to
    };

    if (config.proxy[toUrl]) {
      handleConfigError(`scripts[${scriptId}]: Cannot overwrite proxy[${toUrl}].`);
    }

    config.proxy[toUrl] = fromUrl;
    delete config.scripts[scriptId];
  }

  return config;
}

function normalizeScripts(cwd, scripts) {
  const processedScripts = [];

  if (Object.keys(scripts).filter(k => k.startsWith('bundle:')).length > 1) {
    handleConfigError(`scripts can only contain 1 script of type "bundle:".`);
  }

  for (const scriptId of Object.keys(scripts)) {
    if (scriptId.includes('::watch')) {
      continue;
    }

    const [scriptType, scriptMatch] = scriptId.split(':');

    if (!SCRIPT_TYPES_WEIGHTED[scriptType]) {
      handleConfigError(`scripts[${scriptId}]: "${scriptType}" is not a known script type.`);
    }

    const cmd = scripts[scriptId];
    const newScriptConfig = {
      id: scriptId,
      type: scriptType,
      match: scriptMatch.split(','),
      cmd,
      watch: scripts[`${scriptId}::watch`]
    };

    if (newScriptConfig.watch) {
      newScriptConfig.watch = newScriptConfig.watch.replace('$1', newScriptConfig.cmd);
    }

    if (scriptType === 'mount') {
      const cmdArr = cmd.split(/\s+/);

      if (cmdArr[0] !== 'mount') {
        handleConfigError(`scripts[${scriptId}] must use the mount command`);
      }

      cmdArr.shift();
      const {
        to,
        _
      } = yargs(cmdArr);

      if (_.length !== 1) {
        handleConfigError(`scripts[${scriptId}] must use the format: "mount dir [--to /PATH]"`);
      }

      if (to && to[0] !== '/') {
        handleConfigError(`scripts[${scriptId}]: "--to ${to}" must be a URL path, and start with a "/"`);
      }

      const dirDisk = cmdArr[0];
      const dirUrl = to || `/${cmdArr[0]}`;
      newScriptConfig.args = {
        fromDisk: path.posix.normalize(dirDisk + '/'),
        toUrl: path.posix.normalize(dirUrl + '/')
      };
    }

    processedScripts.push(newScriptConfig);
  }

  const allBuildMatch = new Set();

  for (const {
    type,
    match
  } of processedScripts) {
    if (type !== 'build') {
      continue;
    }

    for (const ext of match) {
      if (allBuildMatch.has(ext)) {
        handleConfigError(`Multiple "scripts" match the "${ext}" file extension.\nCurrently, only one script per file type is supported.`);
      }

      allBuildMatch.add(ext);
    }
  }

  if (!scripts['mount:web_modules']) {
    const fromDisk = process.env.NODE_ENV === 'production' ? BUILD_DEPENDENCIES_DIR : DEV_DEPENDENCIES_DIR;
    processedScripts.push({
      id: 'mount:web_modules',
      type: 'mount',
      match: ['web_modules'],
      cmd: `mount $WEB_MODULES --to /web_modules`,
      args: {
        fromDisk,
        toUrl: '/web_modules'
      }
    });
  }

  const defaultBuildMatch = ['js', 'jsx', 'ts', 'tsx'].filter(ext => !allBuildMatch.has(ext));

  if (defaultBuildMatch.length > 0) {
    const defaultBuildWorkerConfig = {
      id: `build:${defaultBuildMatch.join(',')}`,
      type: 'build',
      match: defaultBuildMatch,
      cmd: '(default) esbuild',
      plugin: esbuildPlugin()
    };
    processedScripts.push(defaultBuildWorkerConfig);
  }

  processedScripts.sort((a, b) => {
    if (a.type === b.type) {
      if (a.id === 'mount:web_modules') {
        return -1;
      }

      if (b.id === 'mount:web_modules') {
        return 1;
      }

      return a.id.localeCompare(b.id);
    }

    return SCRIPT_TYPES_WEIGHTED[a.type] - SCRIPT_TYPES_WEIGHTED[b.type];
  });
  return processedScripts;
}

function normalizeProxies(proxies) {
  return Object.entries(proxies).map(([pathPrefix, options]) => {
    if (typeof options !== 'string') {
      return [pathPrefix, _objectSpread2({
        //@ts-ignore - Seems to be a strange 3.9.x bug
        on: {}
      }, options)];
    }

    return [pathPrefix, {
      on: {
        proxyReq: (proxyReq, req) => {
          const proxyPath = proxyReq.path.split(req.url)[0];
          proxyReq.path = proxyPath + req.url.replace(pathPrefix, '');
        }
      },
      target: options,
      changeOrigin: true,
      secure: false
    }];
  });
}
/** resolve --dest relative to cwd, etc. */


function normalizeConfig(config) {
  const cwd = process.cwd();
  config.knownEntrypoints = config.install || [];
  config.installOptions.dest = path.resolve(cwd, config.installOptions.dest);
  config.devOptions.out = path.resolve(cwd, config.devOptions.out);
  config.exclude = Array.from(new Set([...ALWAYS_EXCLUDE, ...config.exclude]));

  if (!config.scripts) {
    config.exclude.push('**/.*');
    config.scripts = {
      'mount:*': 'mount . --to /'
    };
  }

  if (!config.proxy) {
    config.proxy = {};
  }

  const allPlugins = {};
  config.plugins = config.plugins.map(plugin => {
    const configPluginPath = Array.isArray(plugin) ? plugin[0] : plugin;
    const configPluginOptions = Array.isArray(plugin) && plugin[1] || {};

    const configPluginLoc = require.resolve(configPluginPath, {
      paths: [cwd]
    });

    const configPlugin = require(configPluginLoc)(config, configPluginOptions);

    if ((configPlugin.build ? 1 : 0) + (configPlugin.transform ? 1 : 0) + (configPlugin.bundle ? 1 : 0) > 1) {
      handleConfigError(`plugin[${configPluginLoc}]: A valid plugin can only have one build(), transform(), or bundle() function.`);
    }

    allPlugins[configPluginPath] = configPlugin;

    if (configPlugin.knownEntrypoints) {
      config.knownEntrypoints.push(...configPlugin.knownEntrypoints);
    }

    if (configPlugin.defaultBuildScript && !config.scripts[configPlugin.defaultBuildScript] && !Object.values(config.scripts).includes(configPluginPath)) {
      config.scripts[configPlugin.defaultBuildScript] = configPluginPath;
    }

    return configPlugin;
  });

  if (config.devOptions.bundle === true && !config.scripts['bundle:*']) {
    handleConfigError(`--bundle set to true, but no "bundle:*" script/plugin was provided.`);
  }

  config = handleLegacyProxyScripts(config);
  config.proxy = normalizeProxies(config.proxy);
  config.scripts = normalizeScripts(cwd, config.scripts);
  config.scripts.forEach((script, i) => {
    if (script.plugin) return; // Ensure plugins are properly registered/configured

    if (['build', 'bundle'].includes(script.type)) {
      var _allPlugins$script$cm;

      if ((_allPlugins$script$cm = allPlugins[script.cmd]) === null || _allPlugins$script$cm === void 0 ? void 0 : _allPlugins$script$cm[script.type]) {
        script.plugin = allPlugins[script.cmd];
      } else if (allPlugins[script.cmd] && !allPlugins[script.cmd][script.type]) {
        handleConfigError(`scripts[${script.id}]: Plugin "${script.cmd}" has no ${script.type} script.`);
      } else if (script.cmd.startsWith('@') || script.cmd.startsWith('.')) {
        handleConfigError(`scripts[${script.id}]: Register plugin "${script.cmd}" in your Snowpack "plugins" config.`);
      }
    }
  });
  return config;
}

function handleConfigError(msg) {
  console.error(`[error]: ${msg}`);
  process.exit(1);
}

function handleValidationErrors(filepath, errors) {
  console.error(chalk.red(`! ${filepath || 'Configuration error'}`));
  console.error(errors.map(err => `    - ${err.toString()}`).join('\n'));
  console.error(`    See https://www.snowpack.dev/#configuration for more info.`);
  process.exit(1);
}

function handleDeprecatedConfigError(mainMsg, ...msgs) {
  console.error(chalk.red(mainMsg));
  msgs.forEach(console.error);
  console.error(`See https://www.snowpack.dev/#configuration for more info.`);
  process.exit(1);
}

function validateConfigAgainstV1(rawConfig, cliFlags) {
  var _rawConfig$installOpt, _rawConfig$installOpt2, _rawConfig$devOptions, _rawConfig$installOpt3, _rawConfig$installOpt4, _rawConfig$installOpt5, _rawConfig$installOpt6, _rawConfig$installOpt7;

  // Moved!
  if (rawConfig.dedupe || cliFlags.dedupe) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `dedupe` is now `installOptions.rollup.dedupe`.');
  }

  if (rawConfig.namedExports || cliFlags.namedExports) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `namedExports` is now `installOptions.rollup.namedExports`.');
  }

  if (rawConfig.rollup) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] top-level `rollup` config is now `installOptions.rollup`.');
  }

  if (((_rawConfig$installOpt = rawConfig.installOptions) === null || _rawConfig$installOpt === void 0 ? void 0 : _rawConfig$installOpt.include) || cliFlags.include) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.include` is now handled via "mount" build scripts!');
  }

  if ((_rawConfig$installOpt2 = rawConfig.installOptions) === null || _rawConfig$installOpt2 === void 0 ? void 0 : _rawConfig$installOpt2.exclude) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.exclude` is now `exclude`.');
  }

  if (Array.isArray(rawConfig.webDependencies)) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] The `webDependencies` array is now `install`.');
  }

  if (rawConfig.knownEntrypoints) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `knownEntrypoints` is now `install`.');
  }

  if (rawConfig.entrypoints) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `entrypoints` is now `install`.');
  }

  if (rawConfig.include) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] All files are now included by default. "include" config is safe to remove.', 'Whitelist & include specific folders via "mount" build scripts.');
  } // Replaced!


  if (rawConfig.source || cliFlags.source) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `source` is now detected automatically, this config is safe to remove.');
  }

  if (rawConfig.stat || cliFlags.stat) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `stat` is now the default output, this config is safe to remove.');
  }

  if (rawConfig.scripts && Object.keys(rawConfig.scripts).filter(k => k.startsWith('lintall')).length > 0) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `scripts["lintall:..."]` has been renamed to scripts["run:..."]');
  }

  if (rawConfig.scripts && Object.keys(rawConfig.scripts).filter(k => k.startsWith('plugin:`')).length > 0) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `scripts["plugin:..."]` have been renamed to scripts["build:..."].');
  } // Removed!


  if ((_rawConfig$devOptions = rawConfig.devOptions) === null || _rawConfig$devOptions === void 0 ? void 0 : _rawConfig$devOptions.dist) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `devOptions.dist` is no longer required. This config is safe to remove.', `If you'd still like to host your src/ directory at the "/_dist/*" URL, create a mount script:',
      '    {"scripts": {"mount:src": "mount src --to /_dist_"}} `);
  }

  if (rawConfig.hash || cliFlags.hash) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.hash` has been replaced by `snowpack build`.');
  }

  if (((_rawConfig$installOpt3 = rawConfig.installOptions) === null || _rawConfig$installOpt3 === void 0 ? void 0 : _rawConfig$installOpt3.nomodule) || cliFlags.nomodule) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.nomodule` has been replaced by `snowpack build`.');
  }

  if (((_rawConfig$installOpt4 = rawConfig.installOptions) === null || _rawConfig$installOpt4 === void 0 ? void 0 : _rawConfig$installOpt4.nomoduleOutput) || cliFlags.nomoduleOutput) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.nomoduleOutput` has been replaced by `snowpack build`.');
  }

  if (((_rawConfig$installOpt5 = rawConfig.installOptions) === null || _rawConfig$installOpt5 === void 0 ? void 0 : _rawConfig$installOpt5.babel) || cliFlags.babel) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.babel` has been replaced by `snowpack build`.');
  }

  if (((_rawConfig$installOpt6 = rawConfig.installOptions) === null || _rawConfig$installOpt6 === void 0 ? void 0 : _rawConfig$installOpt6.optimize) || cliFlags.optimize) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.optimize` has been replaced by `snowpack build`.');
  }

  if (((_rawConfig$installOpt7 = rawConfig.installOptions) === null || _rawConfig$installOpt7 === void 0 ? void 0 : _rawConfig$installOpt7.strict) || cliFlags.strict) {
    handleDeprecatedConfigError('[Snowpack v1 -> v2] `installOptions.strict` is no longer supported.');
  }
}

function loadAndValidateConfig(flags, pkgManifest) {
  const explorerSync = cosmiconfig.cosmiconfigSync(CONFIG_NAME, {
    // only support these 3 types of config for now
    searchPlaces: ['package.json', 'snowpack.config.js', 'snowpack.config.json'],
    // don't support crawling up the folder tree:
    stopDir: path.dirname(process.cwd())
  });
  let result; // if user specified --config path, load that

  if (flags.config) {
    result = explorerSync.load(path.resolve(process.cwd(), flags.config));

    if (!result) {
      handleConfigError(`Could not locate Snowpack config at ${flags.config}`);
    }
  } // If no config was found above, search for one.


  result = result || explorerSync.search(); // If still no config found, assume none exists and use the default config.

  if (!result || !result.config || result.isEmpty) {
    result = {
      config: _objectSpread2({}, DEFAULT_CONFIG)
    };
  } // validate against schema; throw helpful user if invalid


  const config = result.config;
  validateConfigAgainstV1(config, flags);
  const cliConfig = expandCliFlags(flags);
  const validation = jsonschema.validate(config, configSchema, {
    allowUnknownAttributes: false,
    propertyName: CONFIG_NAME
  });

  if (validation.errors && validation.errors.length > 0) {
    handleValidationErrors(result.filepath, validation.errors);
    process.exit(1);
  }

  let extendConfig = {};

  if (config.extends) {
    const extendConfigLoc = config.extends.startsWith('.') ? path.resolve(path.dirname(result.filepath), config.extends) : require.resolve(config.extends, {
      paths: [process.cwd()]
    });
    const extendResult = explorerSync.load(extendConfigLoc);

    if (!extendResult) {
      handleConfigError(`Could not locate Snowpack config at ${flags.config}`);
      process.exit(1);
    }

    extendConfig = extendResult.config;
    const extendValidation = jsonschema.validate(extendConfig, configSchema, {
      allowUnknownAttributes: false,
      propertyName: CONFIG_NAME
    });

    if (extendValidation.errors && extendValidation.errors.length > 0) {
      handleValidationErrors(result.filepath, extendValidation.errors);
      process.exit(1);
    }
  } // if valid, apply config over defaults


  const mergedConfig = deepmerge.all([DEFAULT_CONFIG, extendConfig, {
    webDependencies: pkgManifest.webDependencies,
    homepage: pkgManifest.homepage
  }, config, cliConfig]);

  for (const webDependencyName of Object.keys(mergedConfig.webDependencies || {})) {
    if (pkgManifest.dependencies && pkgManifest.dependencies[webDependencyName]) {
      handleConfigError(`"${webDependencyName}" is included in "webDependencies". Please remove it from your package.json "dependencies" config.`);
    }

    if (pkgManifest.devDependencies && pkgManifest.devDependencies[webDependencyName]) {
      handleConfigError(`"${webDependencyName}" is included in "webDependencies". Please remove it from your package.json "devDependencies" config.`);
    }
  }

  return normalizeConfig(mergedConfig);
}

const cwd$2 = process.cwd();

function printHelp() {
  console.log(`
${chalk.bold(`snowpack`)} - A faster build system for the modern web.

  Snowpack is best configured via config file.
  But, most configuration can also be passed via CLI flags.
  📖 ${chalk.dim('https://www.snowpack.dev/#configuration')}

${chalk.bold('Commands:')}
  snowpack dev          Develop your app locally.
  snowpack build        Build your app for production.
  snowpack install      (Advanced) Install web-ready dependencies.

${chalk.bold('Flags:')}
  --config [path]       Set the location of your project config file.
  --help                Show this help message.
  --version             Show the current version.
  --reload              Clear Snowpack's local cache (troubleshooting).
    `.trim());
}

async function cli(args) {
  // parse CLI flags
  const cliFlags = yargs(args, {
    array: ['env', 'exclude', 'externalPackage']
  });

  if (cliFlags.help) {
    printHelp();
    process.exit(0);
  }

  if (cliFlags.version) {
    console.log(require('../package.json').version);
    process.exit(0);
  }

  if (cliFlags.reload) {
    console.log(chalk.yellow('! clearing cache...'));
    await clearCache();
  } // Load the current package manifest


  let pkgManifest;

  try {
    pkgManifest = require(path.join(cwd$2, 'package.json'));
  } catch (err) {
    console.log(chalk.red('[ERROR] package.json required but no file was found.'));
    process.exit(1);
  }

  const cmd = cliFlags['_'][2]; // Set this early -- before config loading -- so that plugins see it.

  if (cmd === 'build') {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  }

  if (cmd === 'dev') {
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  }

  const commandOptions = {
    cwd: cwd$2,
    config: loadAndValidateConfig(cliFlags, pkgManifest),
    lockfile: await readLockfile(cwd$2),
    pkgManifest
  };

  if (cmd === 'add') {
    await addCommand(cliFlags['_'][3], commandOptions);
    return;
  }

  if (cmd === 'rm') {
    await rmCommand(cliFlags['_'][3], commandOptions);
    return;
  }

  if (cliFlags['_'].length > 3) {
    console.log(`Unexpected multiple commands`);
    process.exit(1);
  }

  if (cmd === 'build') {
    await command$1(commandOptions);
    return;
  }

  if (cmd === 'dev') {
    await command$2(commandOptions);
    return;
  }

  if (cmd === 'install' || !cmd) {
    await command(commandOptions);
    return;
  }

  console.log(`Unrecognized command: ${cmd}`);
  process.exit(1);
}

// cli(['','','dev'])
exports.cli = cli;
//# sourceMappingURL=index.js.map
