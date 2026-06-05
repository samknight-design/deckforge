import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getLibrary, setLibraryQuantity, type LibraryCard } from '../lib/db';
import { useTheme } from '../lib/theme';
import ManaCost from '../components/ManaCost';
import CardDetailModal, { type CardDetailData } from '../components/CardDetailModal';

type SortKey = 'name' | 'cmc' | 'price';
type ColorFilter = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
type TypeFilter = 'Creature' | 'Instant' | 'Sorcery' | 'Enchantment' | 'Artifact' | 'Planeswalker' | 'Land';

const COLOR_LABELS: Record<ColorFilter, string> = { W: '☀', U: '💧', B: '💀', R: '🔥', G: '🌿', C: '◇' };
const TYPE_LABELS: TypeFilter[] = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land'];

export default function LibraryScreen({
  userId,
  onGoToScan,
}: {
  userId: string;
  onGoToScan: () => void;
}) {
  const { colors, formatPrice } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [cards, setCards] = useState<LibraryCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [colorFilters, setColorFilters] = useState<Set<ColorFilter>>(new Set());
  const [typeFilter, setTypeFilter] = useState<TypeFilter | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardDetailData | null>(null);

  const load = useCallback(() => {
    getLibrary(userId).then(setCards).catch(() => setCards([]));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    load();
    setRefreshing(false);
  };

  const toggleColor = (c: ColorFilter) => {
    setColorFilters((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!cards) return null;
    let list = cards;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) => c.card_name.toLowerCase().includes(q));
    }
    if (colorFilters.size > 0) {
      list = list.filter((c) => {
        const cardColors: string[] = c.colors || [];
        return Array.from(colorFilters).some((cf) => {
          if (cf === 'C') return cardColors.length === 0;
          return cardColors.includes(cf);
        });
      });
    }
    if (typeFilter) {
      list = list.filter((c) => c.type_line?.includes(typeFilter));
    }
    return [...list].sort((a, b) => {
      if (sortKey === 'cmc') return (a.cmc ?? 0) - (b.cmc ?? 0);
      if (sortKey === 'price') return (b.price_eur ?? 0) - (a.price_eur ?? 0);
      return a.card_name.localeCompare(b.card_name);
    });
  }, [cards, query, colorFilters, typeFilter, sortKey]);

  const totalCards = useMemo(() => (cards || []).reduce((s, c) => s + c.quantity + c.foil_quantity, 0), [cards]);
  const totalValue = useMemo(() => (cards || []).reduce((s, c) => s + (c.price_eur || 0) * (c.quantity + c.foil_quantity), 0), [cards]);

  const adjustQty = async (card: LibraryCard, field: 'quantity' | 'foil_quantity', delta: number) => {
    const nextQty = Math.max(0, (card[field] || 0) + delta);
    const nextFoil = field === 'foil_quantity' ? nextQty : (card.foil_quantity || 0);
    const nextNormal = field === 'quantity' ? nextQty : (card.quantity || 0);

    setCards((prev) => (prev || []).map((c) =>
      c.id === card.id ? { ...c, [field]: nextQty } : c
    ));
    if (selectedCard?.scryfall_id === card.scryfall_id) {
      setSelectedCard((prev) => prev ? { ...prev, [field]: nextQty } : prev);
    }

    try {
      await setLibraryQuantity(userId, card.scryfall_id, nextNormal, nextFoil);
      if (nextNormal === 0 && nextFoil === 0) {
        setCards((prev) => (prev || []).filter((c) => c.id !== card.id));
        setSelectedCard(null);
      }
    } catch {
      load();
    }
  };

  const openCard = (item: LibraryCard) => {
    setSelectedCard({
      scryfall_id: item.scryfall_id,
      card_name: item.card_name,
      image_uri: item.image_uri,
      type_line: item.type_line,
      set_name: item.set_name,
      cmc: item.cmc,
      mana_cost: item.mana_cost,
      colors: item.colors,
      price_eur: item.price_eur,
      quantity: item.quantity,
      foil_quantity: item.foil_quantity,
    });
  };

  const selectedLibraryCard = selectedCard
    ? cards?.find((c) => c.scryfall_id === selectedCard.scryfall_id) ?? null
    : null;

  const renderCard = ({ item }: { item: LibraryCard }) => (
    <Pressable style={styles.card} onPress={() => openCard(item)}>
      {item.image_uri ? (
        <Image source={{ uri: item.image_uri }} style={styles.cardImg} resizeMode="cover" />
      ) : (
        <View style={[styles.cardImg, styles.cardImgPh]}><Text style={{ fontSize: 22 }}>🃏</Text></View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.cardName} numberOfLines={1}>{item.card_name}</Text>
        {!!item.type_line && <Text style={styles.cardMeta} numberOfLines={1}>{item.type_line}</Text>}
        <View style={styles.cardMetaRow}>
          {!!item.set_name && <Text style={styles.cardSet} numberOfLines={1}>{item.set_name}</Text>}
          <ManaCost manaCost={item.mana_cost} size={13} />
        </View>
        {item.price_eur != null && <Text style={styles.cardPrice}>{formatPrice(item.price_eur)}</Text>}

        <View style={styles.qtyRow}>
          <View style={styles.qtyGroup}>
            <Text style={styles.qtyLabel}>Normal</Text>
            <View style={styles.qtyControls}>
              <Pressable style={styles.qtyBtn} onPress={() => adjustQty(item, 'quantity', -1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </Pressable>
              <Text style={styles.qtyValue}>{item.quantity}</Text>
              <Pressable style={styles.qtyBtn} onPress={() => adjustQty(item, 'quantity', 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.qtyGroup}>
            <Text style={[styles.qtyLabel, { color: colors.purple }]}>Foil ✦</Text>
            <View style={styles.qtyControls}>
              <Pressable style={styles.qtyBtn} onPress={() => adjustQty(item, 'foil_quantity', -1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </Pressable>
              <Text style={styles.qtyValue}>{item.foil_quantity}</Text>
              <Pressable style={styles.qtyBtn} onPress={() => adjustQty(item, 'foil_quantity', 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Library</Text>
        <Pressable style={styles.scanBtn} onPress={onGoToScan}>
          <Text style={styles.scanBtnText}>+ Scan</Text>
        </Pressable>
      </View>

      {/* Stats bar */}
      {cards && (
        <View style={styles.statsBar}>
          <Text style={styles.statItem}>{totalCards} cards</Text>
          <View style={styles.statDot} />
          <Text style={styles.statItem}>{(cards || []).length} printings</Text>
          {totalValue > 0 && (
            <>
              <View style={styles.statDot} />
              <Text style={[styles.statItem, { color: colors.success }]}>{formatPrice(totalValue)}</Text>
            </>
          )}
        </View>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search your library…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Filter row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
        {/* Sort buttons */}
        {(['name', 'cmc', 'price'] as SortKey[]).map((s) => (
          <Pressable
            key={s}
            style={[styles.filterChip, sortKey === s && styles.filterChipActive]}
            onPress={() => setSortKey(s)}
          >
            <Text style={[styles.filterChipText, sortKey === s && { color: colors.accent }]}>
              {s === 'name' ? 'A–Z' : s === 'cmc' ? 'CMC' : 'Price'}
            </Text>
          </Pressable>
        ))}
        <View style={styles.filterDivider} />
        {/* Color filters */}
        {(Object.keys(COLOR_LABELS) as ColorFilter[]).map((cf) => (
          <Pressable
            key={cf}
            style={[styles.filterChip, colorFilters.has(cf) && styles.filterChipActive]}
            onPress={() => toggleColor(cf)}
          >
            <Text style={styles.filterChipText}>{COLOR_LABELS[cf]}</Text>
          </Pressable>
        ))}
        <View style={styles.filterDivider} />
        {/* Type filters */}
        {TYPE_LABELS.map((t) => (
          <Pressable
            key={t}
            style={[styles.filterChip, typeFilter === t && styles.filterChipActive]}
            onPress={() => setTypeFilter((prev) => prev === t ? null : t)}
          >
            <Text style={[styles.filterChipText, typeFilter === t && { color: colors.accent }]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* List */}
      {filtered === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : filtered.length === 0 && !query && colorFilters.size === 0 && !typeFilter ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyTitle}>Library is empty</Text>
          <Text style={styles.emptyBody}>Scan cards to start building your collection.</Text>
          <Pressable style={styles.primaryBtn} onPress={onGoToScan}>
            <Text style={styles.primaryBtnText}>📷 Start scanning</Text>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyBody}>No cards matching these filters</Text>
          <Pressable onPress={() => { setQuery(''); setColorFilters(new Set()); setTypeFilter(null); }}>
            <Text style={[styles.emptyBody, { color: colors.accent, marginTop: 8 }]}>Clear filters</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          renderItem={renderCard}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        />
      )}

      {/* Card detail modal */}
      {selectedCard && selectedLibraryCard && (
        <CardDetailModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onAdjust={(field, delta) => adjustQty(selectedLibraryCard, field, delta)}
        />
      )}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    title: { color: c.text, fontSize: 22, fontWeight: '700' },
    scanBtn: { backgroundColor: c.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    scanBtnText: { color: c.accentText, fontWeight: '700', fontSize: 13 },
    statsBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 20, paddingVertical: 10,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    statItem: { color: c.textMuted, fontSize: 13 },
    statDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: c.border },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4,
      paddingHorizontal: 12,
    },
    searchIcon: { fontSize: 14, marginRight: 8 },
    searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 10 },
    clearBtn: { padding: 4 },
    clearBtnText: { color: c.textMuted, fontSize: 13 },
    filterRow: { maxHeight: 42 },
    filterContent: { paddingHorizontal: 16, paddingVertical: 6, gap: 6, flexDirection: 'row', alignItems: 'center' },
    filterChip: {
      paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
    },
    filterChipActive: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.12)' },
    filterChipText: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
    filterDivider: { width: 1, height: 18, backgroundColor: c.border, marginHorizontal: 2 },
    card: {
      flexDirection: 'row', gap: 12,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 12, marginBottom: 10,
    },
    cardImg: { width: 54, height: 76, borderRadius: 6, backgroundColor: c.surfaceAlt },
    cardImgPh: { alignItems: 'center', justifyContent: 'center' },
    cardName: { color: c.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
    cardMeta: { color: c.textMuted, fontSize: 12, marginBottom: 1 },
    cardMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
    cardSet: { color: c.textDim, fontSize: 11 },
    cardPrice: { color: c.success, fontSize: 12, fontWeight: '600', marginBottom: 6 },
    qtyRow: { flexDirection: 'row', gap: 16 },
    qtyGroup: { alignItems: 'center' },
    qtyLabel: { color: c.textDim, fontSize: 10, fontWeight: '600', marginBottom: 4 },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    qtyBtn: {
      width: 24, height: 24, borderRadius: 12,
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnText: { color: c.text, fontSize: 14, lineHeight: 18 },
    qtyValue: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 20, textAlign: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyIcon: { fontSize: 48, marginBottom: 12 },
    emptyTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
    emptyBody: { color: c.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20, maxWidth: 300 },
    primaryBtn: { backgroundColor: c.accent, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
    primaryBtnText: { color: c.accentText, fontWeight: '700' },
  });
