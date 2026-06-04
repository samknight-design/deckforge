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

module.exports = config;
