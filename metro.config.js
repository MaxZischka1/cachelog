const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// geotiff ships a Web Worker pool (via the `web-worker` package) and Node fallbacks that
// Metro cannot bundle. We never create a pool, so resolve them to an empty module.
const EMPTY = path.resolve(__dirname, 'shims/empty.js');
const STUBBED = new Set(['web-worker', 'fs', 'http', 'https', 'url']);

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED.has(moduleName)) return { type: 'sourceFile', filePath: EMPTY };
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
