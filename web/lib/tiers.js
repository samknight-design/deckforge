// Re-export shim — actual implementation moved to @deckforge/shared/tiers so
// it's reachable from both web and mobile. Don't add web-only code here;
// either keep it pure and put it in the shared package, or create a new
// web-local lib file.
export * from '@deckforge/shared/tiers';
