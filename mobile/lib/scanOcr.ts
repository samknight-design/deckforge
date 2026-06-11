// On-device OCR fallback: read the card's printed text and match it against the
// closed dictionary of real card names. Robust exactly where the art fingerprint
// struggles — glare, sleeves, ornate/odd frames, deck clutter — because the title
// text survives those. We never trust the raw OCR spelling: every recognised line
// is snapped to the NEAREST real card name (exact, then bounded fuzzy match).
//
// Sits between the art fingerprint and AI in the scan ladder.

import TextRecognition from '@react-native-ml-kit/text-recognition';
import { prepareScanDb, idAt, nameAt } from './scanLocal';

type NameEntry = { norm: string; idx: number };
let nameIndex: { exact: Map<string, number>; list: NameEntry[] } | null = null;
let buildPromise: Promise<void> | null = null;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Build the unique-name dictionary once (≈27k names). Cheap, cached. Call early
// (on scanner open) so the first OCR isn't delayed.
export async function ensureNameIndex(): Promise<void> {
  if (nameIndex) return;
  if (buildPromise) { await buildPromise; return; }
  buildPromise = (async () => {
    const { db, names } = await prepareScanDb();
    const exact = new Map<string, number>();
    const list: NameEntry[] = [];
    for (let i = 0; i < db.count; i++) {
      const nm = nameAt(names, i);
      if (!nm) continue;
      const norm = normalize(nm);
      if (norm.length < 3) continue;
      if (!exact.has(norm)) { exact.set(norm, i); list.push({ norm, idx: i }); }
    }
    nameIndex = { exact, list };
  })();
  await buildPromise;
}

// Bounded Levenshtein — early-exits once the distance can't beat `max`.
function lev(a: string, b: string, max: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[lb];
}

export type OcrMatch = { id: string; name: string; score: number; via: 'exact' | 'fuzzy' };

// OCR the snapshot and return the best card-name match, or null.
export async function ocrMatch(imageUri: string): Promise<OcrMatch | null> {
  await ensureNameIndex();
  const { ids, names } = await prepareScanDb();
  if (!nameIndex) return null;

  const result = await TextRecognition.recognize(imageUri);

  // Candidate strings: every recognised line, plus pairs of adjacent lines
  // (some titles wrap onto two lines).
  const lines: string[] = [];
  for (const b of result.blocks) for (const l of b.lines) lines.push(l.text);
  const candidates: string[] = [...lines];
  for (let i = 0; i + 1 < lines.length; i++) candidates.push(`${lines[i]} ${lines[i + 1]}`);

  // 1) Exact normalised match — fast and unambiguous.
  for (const c of candidates) {
    const norm = normalize(c);
    if (norm.length < 3) continue;
    const idx = nameIndex.exact.get(norm);
    if (idx != null) {
      const id = idAt(ids, idx), name = nameAt(names, idx);
      if (id && name) return { id, name, score: 1, via: 'exact' };
    }
  }

  // 2) Fuzzy: nearest real name within ~20% edit distance (length-filtered).
  let best: { idx: number; score: number } | null = null;
  for (const c of candidates) {
    const norm = normalize(c);
    if (norm.length < 4) continue;
    for (let k = 0; k < nameIndex.list.length; k++) {
      const e = nameIndex.list[k];
      if (Math.abs(e.norm.length - norm.length) > 3) continue;
      const maxLen = Math.max(e.norm.length, norm.length);
      const maxDist = Math.max(1, Math.floor(maxLen * 0.2));
      const d = lev(norm, e.norm, maxDist);
      if (d > maxDist) continue;
      const score = 1 - d / maxLen;
      if (!best || score > best.score) best = { idx: e.idx, score };
    }
  }
  if (best && best.score >= 0.8) {
    const id = idAt(ids, best.idx), name = nameAt(names, best.idx);
    if (id && name) return { id, name, score: best.score, via: 'fuzzy' };
  }
  return null;
}
