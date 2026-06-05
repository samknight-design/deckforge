import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getDeckCards,
  setDeckCardQuantity,
  setCommander,
  type Deck,
  type DeckCard,
} from '../lib/db';
import { useTheme, BRACKET_COLORS, BRACKET_NAMES } from '../lib/theme';
import ManaCost from '../components/ManaCost';
import CardDetailModal, { type CardDetailData } from '../components/CardDetailModal';

// Card type grouping order
const TYPE_ORDER = ['Commander', 'Partner', 'Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Other'];

function getCardGroup(card: DeckCard): string {
  if (card.is_commander) return 'Commander';
  if (card.is_partner) return 'Partner';
  const t = card.type_line || '';
  for (const type of TYPE_ORDER.slice(2)) {
    if (t.includes(type)) return type;
  }
  return 'Other';
}

function groupCards(cards: DeckCard[]): Array<{ title: string; data: DeckCard[] }> {
  const groups: Record<string, DeckCard[]> = {};
  for (const c of cards) {
    const g = getCardGroup(c);
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  }
  return TYPE_ORDER
    .filter((t) => groups[t]?.length > 0)
    .map((t) => ({ title: t, data: groups[t] }));
}

export default function DeckDetailScreen({
  deck: initialDeck,
  onBack,
  onScanInto,
  onInsights,
}: {
  deck: Deck;
  onBack: () => void;
  onScanInto: (deck: Deck) => void;
  onInsights?: (deck: Deck) => void;
}) {
  const { colors, formatPrice } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [deck, setDeck] = useState<Deck>(initialDeck);
  const [cards, setCards] = useState<DeckCard[] | null>(null);
  const [selectedCard, setSelectedCard] = useState<{ card: CardDetailData; deckCard: DeckCard } | null>(null);

  const load = useCallback(() => {
    setCards(null);
    getDeckCards(deck.id).then(setCards).catch(() => setCards([]));
  }, [deck.id]);

  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => cards ? groupCards(cards) : [], [cards]);
  const totalCards = (cards || []).reduce((s, c) => s + (c.quantity || 1), 0);
  const totalValue = (cards || []).reduce((s, c) => s + (c.price_eur || 0) * (c.quantity || 1), 0);

  const adjustQty = async (card: DeckCard, delta: number) => {
    const next = Math.max(0, (card.quantity || 1) + delta);
    setCards((prev) => {
      if (!prev) return prev;
      if (next === 0) return prev.filter((c) => c.id !== card.id);
      return prev.map((c) => c.id === card.id ? { ...c, quantity: next } : c);
    });
    try {
      await setDeckCardQuantity(card.id, next);
    } catch {
      load();
    }
  };

  const handleSetCommander = async (card: DeckCard, isPartner: boolean) => {
    const currentFlag = isPartner ? card.is_partner : card.is_commander;
    const nextScryfallId = currentFlag ? null : card.scryfall_id;
    await setCommander(deck.id, nextScryfallId, isPartner);
    // Update deck meta locally
    if (!isPartner) {
      setDeck((d) => ({
        ...d,
        commander_name: nextScryfallId ? card.card_name : null,
        commander_image_url: nextScryfallId ? card.image_uri : null,
      }));
    } else {
      setDeck((d) => ({
        ...d,
        partner_name: nextScryfallId ? card.card_name : null,
        partner_image_url: nextScryfallId ? card.image_uri : null,
      }));
    }
    load();
    setSelectedCard(null);
  };

  const bracketColor = deck.bracket ? (BRACKET_COLORS[deck.bracket] || colors.textDim) : colors.textDim;
  const bracketName = deck.bracket ? (BRACKET_NAMES[deck.bracket] || '') : null;

  const openCard = (item: DeckCard) => {
    setSelectedCard({
      card: {
        scryfall_id: item.scryfall_id,
        card_name: item.card_name,
        image_uri: item.image_uri,
        type_line: item.type_line,
        cmc: item.cmc,
        mana_cost: item.mana_cost,
        colors: item.colors,
        price_eur: item.price_eur,
        is_foil: item.is_foil,
      },
      deckCard: item,
    });
  };

  const renderCard = ({ item }: { item: DeckCard }) => (
    <Pressable style={styles.cardRow} onPress={() => openCard(item)}>
      {item.image_uri ? (
        <Image source={{ uri: item.image_uri }} style={styles.cardThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.cardThumb, styles.thumbPh]}><Text>🃏</Text></View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.cardNameRow}>
          <Text style={styles.cardName} numberOfLines={1}>{item.card_name}{item.is_foil ? ' ✦' : ''}</Text>
          <ManaCost manaCost={item.mana_cost} size={12} />
        </View>
        {!!item.type_line && <Text style={styles.cardMeta} numberOfLines={1}>{item.type_line}</Text>}
      </View>
      {/* Quantity controls */}
      <View style={styles.qtyControls}>
        <Pressable style={styles.qtyBtn} onPress={() => adjustQty(item, -1)}>
          <Text style={styles.qtyBtnTxt}>−</Text>
        </Pressable>
        <Text style={styles.qtyNum}>{item.quantity || 1}</Text>
        <Pressable style={styles.qtyBtn} onPress={() => adjustQty(item, 1)}>
          <Text style={styles.qtyBtnTxt}>+</Text>
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Decks</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{deck.name}</Text>
        <View style={{ width: 64 }} />
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <Text style={styles.stat}>{totalCards} cards</Text>
        <Text style={styles.statDot}>·</Text>
        <Text style={styles.stat}>{deck.format === 'commander' ? 'Commander' : '60-Card'}</Text>
        {totalValue > 0 && (
          <>
            <Text style={styles.statDot}>·</Text>
            <Text style={[styles.stat, { color: colors.success }]}>{formatPrice(totalValue)}</Text>
          </>
        )}
        {deck.bracket ? (
          <>
            <Text style={styles.statDot}>·</Text>
            <View style={[styles.bracketBadge, { borderColor: bracketColor }]}>
              <Text style={[styles.bracketBadgeText, { color: bracketColor }]}>B{deck.bracket} {bracketName}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.statDot}>·</Text>
            <Text style={[styles.stat, { color: colors.textDim }]}>No bracket</Text>
          </>
        )}
      </View>

      {/* Commander display */}
      {(deck.commander_name || deck.partner_name) && (
        <View style={styles.commanderRow}>
          {deck.commander_image_url && (
            <Image source={{ uri: deck.commander_image_url }} style={styles.commanderThumb} resizeMode="cover" />
          )}
          <View style={{ flex: 1 }}>
            {deck.commander_name && <Text style={styles.commanderName} numberOfLines={1}>⚔ {deck.commander_name}</Text>}
            {deck.partner_name && <Text style={styles.partnerName} numberOfLines={1}>⚔ {deck.partner_name} (Partner)</Text>}
          </View>
        </View>
      )}

      {cards === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : cards.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🃏</Text>
          <Text style={styles.emptyBody}>No cards yet. Scan some in!</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.reduce((s, c) => s + (c.quantity || 1), 0)}</Text>
            </View>
          )}
          renderItem={renderCard}
        />
      )}

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {onInsights && (
            <Pressable style={styles.insightsBtn} onPress={() => onInsights(deck)}>
              <Text style={styles.insightsBtnText}>🧠 AI Insights</Text>
            </Pressable>
          )}
          <Pressable style={[styles.scanBtn, onInsights && { flex: 1 }]} onPress={() => onScanInto(deck)}>
            <Text style={styles.scanBtnText}>📷 Scan into deck</Text>
          </Pressable>
        </View>
      </View>

      {/* Card detail modal */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          onClose={() => setSelectedCard(null)}
          onSetCommander={() => handleSetCommander(selectedCard.deckCard, false)}
          onSetPartner={deck.format === 'commander' ? () => handleSetCommander(selectedCard.deckCard, true) : undefined}
          isCommander={selectedCard.deckCard.is_commander}
          isPartner={selectedCard.deckCard.is_partner}
        />
      )}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, paddingTop: 50 },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingBottom: 10,
    },
    topTitle: { color: c.text, fontWeight: '700', fontSize: 17, flex: 1, textAlign: 'center' },
    backBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    backBtnText: { color: c.textMuted, fontSize: 13 },
    statsRow: {
      flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      paddingHorizontal: 16, paddingBottom: 10,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    stat: { color: c.textMuted, fontSize: 12 },
    statDot: { color: c.textDim },
    bracketBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
    bracketBadgeText: { fontSize: 11, fontWeight: '700' },
    commanderRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 8,
      borderBottomColor: c.border, borderBottomWidth: 1,
      backgroundColor: c.surface,
    },
    commanderThumb: { width: 36, height: 36, borderRadius: 6 },
    commanderName: { color: c.accent, fontSize: 13, fontWeight: '600' },
    partnerName: { color: c.textMuted, fontSize: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyEmoji: { fontSize: 44, marginBottom: 10 },
    emptyBody: { color: c.textMuted },
    sectionHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 6, paddingHorizontal: 4, marginTop: 8,
    },
    sectionTitle: { color: c.accent, fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
    sectionCount: { color: c.textDim, fontSize: 11, fontWeight: '600' },
    cardRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 8,
      borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    cardThumb: { width: 36, height: 50, borderRadius: 5, backgroundColor: c.surfaceAlt },
    thumbPh: { alignItems: 'center', justifyContent: 'center' },
    cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
    cardName: { color: c.text, fontSize: 13, fontWeight: '500', flex: 1 },
    cardMeta: { color: c.textMuted, fontSize: 11, marginTop: 2 },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    qtyBtn: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnTxt: { color: c.text, fontSize: 13, lineHeight: 17 },
    qtyNum: { color: c.text, fontSize: 13, fontWeight: '700', minWidth: 18, textAlign: 'center' },
    bottomBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: 16, paddingBottom: 28,
      backgroundColor: c.overlay,
      borderTopColor: c.border, borderTopWidth: 1,
    },
    scanBtn: { backgroundColor: c.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center', flex: 2 },
    scanBtnText: { color: c.accentText, fontWeight: '700', fontSize: 15 },
    insightsBtn: {
      flex: 1, backgroundColor: c.surface, borderColor: c.purple, borderWidth: 1,
      paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    },
    insightsBtnText: { color: c.purple, fontWeight: '700', fontSize: 14 },
  });
