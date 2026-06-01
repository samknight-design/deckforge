// Simple string hash (djb2)
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // Convert to unsigned 32-bit integer
  }
  return hash.toString(16);
}

export function computeDeckHash(cards) {
  // cards = [{ card_name, quantity }, ...]
  const sorted = [...cards]
    .sort((a, b) => a.card_name.localeCompare(b.card_name))
    .map((c) => `${c.quantity}:${c.card_name}`)
    .join('|');
  return hashString(sorted);
}

export function groupCardsByType(cards) {
  const groups = {
    Commanders: [],
    Creatures: [],
    Instants: [],
    Sorceries: [],
    Enchantments: [],
    Artifacts: [],
    Planeswalkers: [],
    Lands: [],
    Other: [],
  };

  for (const card of cards) {
    if (card.is_commander || card.is_partner) {
      groups.Commanders.push(card);
      continue;
    }
    const type = card.type_line || '';
    if (type.includes('Land')) {
      groups.Lands.push(card);
    } else if (type.includes('Creature')) {
      groups.Creatures.push(card);
    } else if (type.includes('Instant')) {
      groups.Instants.push(card);
    } else if (type.includes('Sorcery')) {
      groups.Sorceries.push(card);
    } else if (type.includes('Enchantment')) {
      groups.Enchantments.push(card);
    } else if (type.includes('Artifact')) {
      groups.Artifacts.push(card);
    } else if (type.includes('Planeswalker')) {
      groups.Planeswalkers.push(card);
    } else {
      groups.Other.push(card);
    }
  }

  // Remove empty groups and commanders if format isn't commander
  return Object.fromEntries(
    Object.entries(groups).filter(([, cards]) => cards.length > 0)
  );
}

export function computeDeckStats(cards) {
  const nonLands = cards.filter((c) => !c.type_line?.includes('Land'));
  const lands = cards.filter((c) => c.type_line?.includes('Land'));

  const totalCards = cards.reduce((sum, c) => sum + (c.quantity || 1), 0);
  const landCount = lands.reduce((sum, c) => sum + (c.quantity || 1), 0);

  const totalCmc = nonLands.reduce(
    (sum, c) => sum + (c.cmc || 0) * (c.quantity || 1),
    0
  );
  const nonLandCount = nonLands.reduce((sum, c) => sum + (c.quantity || 1), 0);
  const avgCmc = nonLandCount > 0 ? (totalCmc / nonLandCount).toFixed(2) : '0.00';

  const totalValue = cards.reduce((sum, c) => {
    const price = c.price_eur || 0;
    return sum + price * (c.quantity || 1);
  }, 0);

  // Mana curve: CMC 0-7+
  const manaCurve = Array(8).fill(0);
  for (const card of nonLands) {
    const cmc = Math.min(Math.floor(card.cmc || 0), 7);
    manaCurve[cmc] += card.quantity || 1;
  }

  // Color distribution
  const colorMap = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const card of cards) {
    const colors = card.colors || [];
    if (colors.length === 0 && !card.type_line?.includes('Land')) {
      colorMap.C += card.quantity || 1;
    }
    for (const color of colors) {
      if (colorMap[color] !== undefined) {
        colorMap[color] += card.quantity || 1;
      }
    }
  }

  // Type breakdown
  const typeBreakdown = {
    Creatures: 0,
    Instants: 0,
    Sorceries: 0,
    Enchantments: 0,
    Artifacts: 0,
    Planeswalkers: 0,
    Lands: 0,
    Other: 0,
  };
  for (const card of cards) {
    const type = card.type_line || '';
    const qty = card.quantity || 1;
    if (type.includes('Land')) typeBreakdown.Lands += qty;
    else if (type.includes('Creature')) typeBreakdown.Creatures += qty;
    else if (type.includes('Instant')) typeBreakdown.Instants += qty;
    else if (type.includes('Sorcery')) typeBreakdown.Sorceries += qty;
    else if (type.includes('Enchantment')) typeBreakdown.Enchantments += qty;
    else if (type.includes('Artifact')) typeBreakdown.Artifacts += qty;
    else if (type.includes('Planeswalker')) typeBreakdown.Planeswalkers += qty;
    else typeBreakdown.Other += qty;
  }

  return {
    totalCards,
    landCount,
    avgCmc,
    totalValue: totalValue.toFixed(2),
    manaCurve,
    colorMap,
    typeBreakdown,
  };
}

// Basic land names exempt from singleton rule
const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest', 'Snow-Covered Wastes',
]);

export function getDeckWarnings(cards, format, commanderColorIdentity) {
  const warnings = [];
  if (format !== 'commander') return warnings;

  // 1. Singleton violations
  for (const card of cards) {
    const isBasic = card.type_line?.includes('Basic') || BASIC_LAND_NAMES.has(card.card_name);
    if (!isBasic && (card.quantity || 1) > 1) {
      warnings.push({ type: 'singleton', card: card.card_name, qty: card.quantity });
    }
  }

  // 2. Color identity violations (only when a commander is declared)
  if (commanderColorIdentity && commanderColorIdentity.length > 0) {
    for (const card of cards) {
      if (card.is_commander || card.is_partner) continue;
      const cardCI = card.color_identity || [];
      // Colorless cards (no color identity) are always legal
      if (cardCI.length === 0) continue;
      const illegal = cardCI.some((c) => !commanderColorIdentity.includes(c));
      if (illegal) {
        warnings.push({ type: 'color_identity', card: card.card_name, cardCI, commanderCI: commanderColorIdentity });
      }
    }
  }

  return warnings;
}

// Plain-text decklist export (Moxfield/Archidekt-friendly): "<qty> <name>",
// commanders grouped first, foils flagged with *F*.
export function exportDecklist(cards, deck) {
  const lines = [];
  if (deck?.name) lines.push(`// ${deck.name}`);
  const commanders = cards.filter((c) => c.is_commander || c.is_partner);
  const rest = cards.filter((c) => !(c.is_commander || c.is_partner));

  if (commanders.length) {
    lines.push('// Commander');
    commanders.forEach((c) => lines.push(`${c.quantity || 1} ${c.card_name}${c.is_foil ? ' *F*' : ''}`));
    lines.push('');
  }

  [...rest]
    .sort((a, b) => (a.card_name || '').localeCompare(b.card_name || ''))
    .forEach((c) => lines.push(`${c.quantity || 1} ${c.card_name}${c.is_foil ? ' *F*' : ''}`));

  return lines.join('\n');
}

// Section headers used by Moxfield / Archidekt / MTGGoldfish exports.
const DECKLIST_SECTIONS = new Set([
  'commander', 'commanders', 'companion', 'deck', 'mainboard', 'main',
  'sideboard', 'sb', 'maybeboard', 'maybe', 'considering', 'tokens', 'token',
  'stickers', 'attractions', 'planes', 'schemes', 'conspiracy', 'signature spells',
]);
// Sections whose cards are NOT part of the maindeck and should be skipped.
const DECKLIST_SKIP_SECTIONS = new Set(['sideboard', 'sb', 'maybeboard', 'maybe', 'considering', 'tokens', 'token']);

// Robust decklist parser. Handles plain lists plus Moxfield/Archidekt/MTGGoldfish
// exports: "1 Card", "1x Card", "Card x1", set+collector annotations like
// "(2X2) 117", foil markers (*F*, *E*), commander markers (*CMDR*), category
// brackets ([Ramp]) and section headers (Commander / Deck / Sideboard / …).
export function parseDeckList(text) {
  const lines = text.split('\n');
  const cards = [];
  let section = 'deck';

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (/^sb:/i.test(line)) continue; // legacy sideboard prefix

    // Section header? e.g. "Commander", "Deck (99)", "Sideboard:"
    const headerKey = line.replace(/\(\d+\)\s*$/, '').replace(/:/g, '').trim().toLowerCase();
    if (DECKLIST_SECTIONS.has(headerKey)) { section = headerKey; continue; }
    if (DECKLIST_SKIP_SECTIONS.has(section)) continue;

    // Leading bullets
    let work = line.replace(/^[-*•]\s+/, '');

    // Quantity (prefix "4 " / "4x ", or suffix " x4")
    let quantity = 1;
    let m;
    if ((m = work.match(/^(\d+)\s*[xX]?\s+(.+)$/))) { quantity = parseInt(m[1], 10); work = m[2]; }
    else if ((m = work.match(/^(.+?)\s+[xX](\d+)$/))) { work = m[1]; quantity = parseInt(m[2], 10); }

    // Finish / role markers
    const foil = /\*\s*(?:f|e|foil|etched)\s*\*/i.test(work);
    const cmdrMark = /\*\s*(?:cmdr|commander)\s*\*/i.test(work);

    // Set code + collector number, e.g. "(2X2) 117" or "(cmm) 100"
    let set = null;
    let collector = null;
    const sc = work.match(/\(([0-9A-Za-z]{2,6})\)\s+([0-9]+[A-Za-z★]?)/);
    if (sc) { set = sc[1].toLowerCase(); collector = sc[2]; }

    // Strip annotations to leave a clean card name
    const name = work
      .replace(/\*[^*]*\*/g, ' ')                                // *F* / *CMDR*
      .replace(/\[[^\]]*\]/g, ' ')                               // [Category]
      .replace(/\(([0-9A-Za-z]{2,6})\)\s+[0-9]+[A-Za-z★]?/g, ' ') // (SET) collector
      .replace(/\([0-9A-Za-z]*\d[0-9A-Za-z]*\)/g, ' ')           // lone (SET) containing a digit
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[•\-–—|]+\s*$/, '')
      .trim();

    if (!name) continue;

    cards.push({
      name,
      quantity: quantity > 0 ? quantity : 1,
      foil,
      commander: cmdrMark || section === 'commander' || section === 'commanders',
      set,
      collector_number: collector,
    });
  }

  return cards;
}
