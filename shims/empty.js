// Stand-in for Node/web-only modules pulled in by geotiff (worker pool, fs, http).
// Cachelog decodes GeoTIFFs on the JS thread without a pool, so these are never called.
module.exports = {};
