// IMPORTANT: react-native-url-polyfill/auto MUST be the very first import in
// the app. Supabase JS uses URL/URLSearchParams; RN doesn't ship them
// natively, and "Network request failed" is what you get if the polyfill
// loads after Supabase's first fetch is queued.
import 'react-native-url-polyfill/auto';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(App);
