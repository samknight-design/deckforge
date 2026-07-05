// A real draggable bottom sheet: grab the handle and drag down to dismiss (or
// flick). No "Done" button needed. Tapping the backdrop also closes. Inner
// ScrollViews still scroll because the drag responder lives on the handle area.

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';

export default function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const dismiss = () => {
    Animated.timing(translateY, { toValue: 700, duration: 180, useNativeDriver: true }).start(() => {
      translateY.setValue(0);
      onClose();
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.8) dismiss();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View {...pan.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderColor: '#1e2d47', borderWidth: 1, paddingHorizontal: 20, paddingBottom: 28,
  },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#334155' },
});
