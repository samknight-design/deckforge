// Metro config for the DeckForge Expo app inside our monorepo.
//
// Expo's default config (getDefaultConfig) already handles most monorepo
// gotchas in SDK 54. The only thing we EXTEND is watchFolders, so changes
// in shared/ trigger hot reload during development. We don't override
// nodeModulesPaths or disableHierarchicalLookup — Expo's defaults are
// correct, and overriding them broke `expo doctor`.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '..');

const config = getDefaultConfig(projectRoot);

// Append the workspace root to whatever Expo already watches.
config.watchFolders = [...(config.watchFolders || []), workspaceRoot];

// Treat the bundled hash DB files as ASSETS (resolved to a local file URI and
// read at runtime) rather than source modules. Without this, require()-ing
// cards.idx would try to parse it as JS, and the 14 MB DB would be inlined
// into the JS bundle, bloating cold start.
config.resolver.assetExts.push('bin', 'idx');

module.exports = config;
