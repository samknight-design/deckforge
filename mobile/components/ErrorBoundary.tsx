// Catches render/runtime crashes in its child tree and shows a readable message
// on screen (with the error text) instead of a white screen or a hard crash.
// Used to wrap the camera/scanner so we can SEE what went wrong on-device.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = { onBack: () => void; children: React.ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary] caught:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={S.wrap}>
        <Text style={S.title}>⚠️ Scanner hit an error</Text>
        <Text style={S.sub}>This is the actual error — copy it to Claude:</Text>
        <ScrollView style={S.box} contentContainerStyle={{ padding: 14 }}>
          <Text style={S.msg}>{error.name}: {error.message}</Text>
          {!!error.stack && <Text style={S.stack}>{error.stack}</Text>}
        </ScrollView>
        <View style={S.row}>
          <Pressable style={[S.btn, S.btnAlt]} onPress={this.reset}>
            <Text style={S.btnAltText}>Try again</Text>
          </Pressable>
          <Pressable style={[S.btn, S.btnMain]} onPress={this.props.onBack}>
            <Text style={S.btnMainText}>← Back to safety</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0e1a', padding: 20, paddingTop: 70 },
  title: { color: '#ef4444', fontSize: 20, fontWeight: '700', marginBottom: 6 },
  sub: { color: '#94a3b8', fontSize: 13, marginBottom: 12 },
  box: { flex: 1, backgroundColor: '#111827', borderRadius: 12, borderWidth: 1, borderColor: '#1e2d47' },
  msg: { color: '#fca5a5', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  stack: { color: '#64748b', fontSize: 11, fontFamily: 'monospace' },
  row: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnAlt: { backgroundColor: '#1a2235', borderWidth: 1, borderColor: '#1e2d47' },
  btnAltText: { color: '#94a3b8', fontWeight: '600' },
  btnMain: { backgroundColor: '#f59e0b' },
  btnMainText: { color: '#0a0e1a', fontWeight: '700' },
});
