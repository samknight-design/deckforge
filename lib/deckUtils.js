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

export function parseDeckList(text) {
  const lines = text.split('\n');
  const cards = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('SB:')) continue;

    let quantity = 1;
    let name = line;

    // "4x Lightning Bolt" or "4X Lightning Bolt"
    const matchPrefix = line.match(/^(\d+)[xX]\s+(.+)$/);
    // "4 Lightning Bolt"
    const matchNum = line.match(/^(\d+)\s+(.+)$/);
    // "Lightning Bolt x4" or "Lightning Bolt X4"
    const matchSuffix = line.match(/^(.+?)\s+[xX](\d+)$/);

    if (matchPrefix) {
      quantity = parseInt(matchPrefix[1], 10);
      name = matchPrefix[2].trim();
    } else if (matchNum) {
      quantity = parseInt(matchNum[1], 10);
      name = matchNum[2].trim();
    } else if (matchSuffix) {
      name = matchSuffix[1].trim();
      quantity = parseInt(matchSuffix[2], 10);
    }

    if (name) {
      cards.push({ name, quantity });
    }
  }

  return cards;
}
