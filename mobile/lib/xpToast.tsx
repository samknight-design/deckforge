// Global XP toast context. Wrap the app in <XpToastProvider> then call
// showXp(amount, reason) from any screen to trigger a floating "+25 XP" pill.

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

type XpToastCtx = {
  showXp: (amount: number, reason: string) => void;
};

const XpToastContext = createContext<XpToastCtx>({ showXp: () => {} });

export function useXpToast() {
  return useContext(XpToastContext);
}

type ToastItem = { id: number; amount: number; reason: string };

export function XpToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showXp = useCallback((amount: number, reason: string) => {
    if (amount <= 0) return;
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, amount, reason }]);
    // Auto-remove after animation (2.8s)
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  return (
    <XpToastContext.Provider value={{ showXp }}>
      {children}
      {/* Toasts stack from bottom upward */}
      <View style={styles.container} pointerEvents="none">
        {toasts.map((toast, i) => (
          <XpToastItem
            key={toast.id}
            toast={toast}
            index={i}
            colors={colors}
          />
        ))}
      </View>
    </XpToastContext.Provider>
  );
}

function XpToastItem({
  toast,
  index,
  colors,
}: {
  toast: ToastItem;
  index: number;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const translateY = useRef(new Animated.Value(60)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Slide up + fade in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 160,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Fade out after 2s
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }, 2000);

    return () => clearTimeout(t);
  }, [opacity, translateY]);

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          backgroundColor: colors.accent,
          bottom: 110 + index * 52,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Text style={[styles.xpText, { color: colors.accentText }]}>
        +{toast.amount} XP
      </Text>
      <View style={[styles.divider, { backgroundColor: colors.accentText, opacity: 0.3 }]} />
      <Text style={[styles.reasonText, { color: colors.accentText }]} numberOfLines={1}>
        {toast.reason}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  } as any,
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  xpText: {
    fontWeight: '800',
    fontSize: 15,
  },
  divider: {
    width: 1,
    height: 14,
  },
  reasonText: {
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 180,
  },
});
