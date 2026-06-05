// Full-card detail modal. Tap any card in Library or Deck to open this.
// Shows large card art, name, type, CMC pips, price, set, and qty controls.

import { useMemo } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../lib/theme';
import ManaCost from './ManaCost';

export type CardDetailData = {
  scryfall_id: string;
  card_name: string;
  image_uri?: string | null;
  type_line?: string | null;
  set_name?: string | null;
  cmc?: number | null;
  mana_cost?: string | null;
  colors?: string[] | null;
  price_eur?: number | null;
  is_foil?: boolean;
  // library mode extras
  quantity?: number;
  foil_quantity?: number;
};

type Props = {
  card: CardDetailData | null;
  onClose: () => void;
  // supply these to show +/- controls
  onAdjust?: (field: 'quantity' | 'foil_quantity', delta: number) => void;
  // supply to show commander button
  onSetCommander?: () => void;
  onSetPartner?: () => void;
  isCommander?: boolean;
  isPartner?: boolean;
};

export default function CardDetailModal({
  card,
  onClose,
  onAdjust,
  onSetCommander,
  onSetPartner,
  isCommander,
  isPartner,
}: Props) {
  const { colors, formatPrice } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!card) return null;

  const totalOwned = (card.quantity ?? 0) + (card.foil_quantity ?? 0);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Card image */}
          <View style={styles.imageWrap}>
            {card.image_uri ? (
              <Image source={{ uri: card.image_uri }} style={styles.image} resizeMode="contain" />
            ) : (
              <View style={[styles.image, styles.imagePh]}>
                <Text style={{ fontSize: 48 }}>🃏</Text>
              </View>
            )}
          </View>

          {/* Name + mana cost */}
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>{card.card_name}</Text>
            <ManaCost manaCost={card.mana_cost} size={18} />
          </View>

          {/* Meta row */}
          <View style={styles.metaRow}>
            {card.type_line ? <Text style={styles.typeLine}>{card.type_line}</Text> : null}
            {card.cmc != null && (
              <View style={styles.cmcBadge}>
                <Text style={styles.cmcText}>CMC {card.cmc}</Text>
              </View>
            )}
          </View>

          {card.set_name ? <Text style={styles.set}>{card.set_name}</Text> : null}

          {/* Price */}
          {card.price_eur != null && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Market price</Text>
              <Text style={styles.price}>{formatPrice(card.price_eur)}</Text>
            </View>
          )}

          {/* Quantity controls (library mode) */}
          {onAdjust && (
            <View style={styles.qtySection}>
              <View style={styles.qtyBlock}>
                <Text style={styles.qtyLabel}>Normal</Text>
                <View style={styles.qtyRow}>
                  <Pressable style={styles.qtyBtn} onPress={() => onAdjust('quantity', -1)}>
                    <Text style={styles.qtyBtnTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyVal}>{card.quantity ?? 0}</Text>
                  <Pressable style={styles.qtyBtn} onPress={() => onAdjust('quantity', 1)}>
                    <Text style={styles.qtyBtnTxt}>+</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.qtyBlock}>
                <Text style={[styles.qtyLabel, { color: colors.purple }]}>Foil ✦</Text>
                <View style={styles.qtyRow}>
                  <Pressable style={styles.qtyBtn} onPress={() => onAdjust('foil_quantity', -1)}>
                    <Text style={styles.qtyBtnTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyVal}>{card.foil_quantity ?? 0}</Text>
                  <Pressable style={styles.qtyBtn} onPress={() => onAdjust('foil_quantity', 1)}>
                    <Text style={styles.qtyBtnTxt}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {/* Commander controls */}
          {onSetCommander && (
            <Pressable
              style={[styles.cmdBtn, isCommander && styles.cmdBtnActive]}
              onPress={onSetCommander}
            >
              <Text style={[styles.cmdBtnText, isCommander && { color: colors.accent }]}>
                {isCommander ? '★ Commander' : '☆ Set as Commander'}
              </Text>
            </Pressable>
          )}
          {onSetPartner && (
            <Pressable
              style={[styles.cmdBtn, isPartner && styles.cmdBtnActive]}
              onPress={onSetPartner}
            >
              <Text style={[styles.cmdBtnText, isPartner && { color: colors.accent }]}>
                {isPartner ? '★ Partner Commander' : '☆ Set as Partner'}
              </Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Close button */}
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.overlay },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopColor: c.border,
      borderTopWidth: 1,
      maxHeight: '90%',
    },
    handle: {
      width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
      alignSelf: 'center', marginTop: 12, marginBottom: 4,
    },
    scroll: { padding: 20, paddingBottom: 8 },
    imageWrap: { alignItems: 'center', marginBottom: 16 },
    image: { width: 200, height: 279, borderRadius: 12 },
    imagePh: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    name: { color: c.text, fontSize: 20, fontWeight: '700', flex: 1, marginRight: 12 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    typeLine: { color: c.textMuted, fontSize: 13, flex: 1 },
    cmcBadge: {
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
    },
    cmcText: { color: c.textMuted, fontSize: 11, fontWeight: '600' },
    set: { color: c.textDim, fontSize: 11, marginBottom: 12 },
    priceRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 16,
    },
    priceLabel: { color: c.textMuted, fontSize: 13 },
    price: { color: c.success, fontWeight: '700', fontSize: 18 },
    qtySection: { flexDirection: 'row', gap: 16, marginBottom: 16 },
    qtyBlock: { flex: 1, alignItems: 'center' },
    qtyLabel: { color: c.textDim, fontSize: 11, fontWeight: '600', marginBottom: 8 },
    qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    qtyBtn: {
      width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceAlt,
      borderColor: c.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnTxt: { color: c.text, fontSize: 18, lineHeight: 22 },
    qtyVal: { color: c.text, fontSize: 20, fontWeight: '700', minWidth: 28, textAlign: 'center' },
    cmdBtn: {
      borderColor: c.border, borderWidth: 1, borderRadius: 12,
      paddingVertical: 12, alignItems: 'center', marginBottom: 8,
    },
    cmdBtnActive: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.1)' },
    cmdBtnText: { color: c.textMuted, fontWeight: '600', fontSize: 14 },
    closeBtn: {
      margin: 16, marginTop: 8, backgroundColor: c.accent,
      paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    },
    closeBtnText: { color: c.accentText, fontWeight: '700', fontSize: 15 },
  });
