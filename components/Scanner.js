'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { showToast } from './Toast';
import CardResultSheet from './CardResultSheet';

const MODES = ['Scan', 'Search'];
const NEW_DECK = '__new__';

const COLOR_LABELS = { W: '☀', U: '💧', B: '💀', R: '🔥', G: '🌿', C: '◇' };
const COLOR_STYLES = {
  W: { bg: '#f3f4f6', text: '#1f2937', border: '#d1d5db' },
  U: { bg: '#2563eb', text: '#fff', border: '#1d4ed8' },
  B: { bg: '#374151', text: '#f9fafb', border: '#4b5563' },
  R: { bg: '#dc2626', text: '#fff', border: '#b91c1c' },
  G: { bg: '#16a34a', text: '#fff', border: '#15803d' },
  C: { bg: '#6b7280', text: '#fff', border: '#4b5563' },
};
const TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land'];
const RARITIES = [
  { key: 'c', label: 'C', title: 'Common', color: '#9ca3af' },
  { key: 'u', label: 'U', title: 'Uncommon', color: '#93c5fd' },
  { key: 'r', label: 'R', title: 'Rare', color: '#fbbf24' },
  { key: 'm', label: 'M', title: 'Mythic', color: '#f97316' },
];

function buildScryfallQuery({ name, colors, cardType, cmc, rarity }) {
  const parts = [];
  if (name && name.trim().length >= 1) parts.push(`name:"${name.trim()}"`);
  if (colors.length > 0) {
    const colorStr = colors.filter((c) => c !== 'C').join('');
    const hasColorless = colors.includes('C');
    if (hasColorless && colorStr.length === 0) parts.push('c:colorless');
    else if (colorStr.length > 0) parts.push(`c:${colorStr}`);
  }
  if (cardType) parts.push(`t:${cardType.toLowerCase()}`);
  if (cmc !== null && cmc !== '') {
    if (cmc === '7+') parts.push('cmc>=7');
    else parts.push(`cmc=${cmc}`);
  }
  if (rarity) parts.push(`r:${rarity}`);
  return parts.join(' ');
}

// ── Auto-scan tuning ─────────────────────────────────────────────────────────
const FRAME_MS        = 150;   // how often to sample (ms)
const FRAMES_PREVIEW  = 3;     // stable frames before showing green (~450ms)
const FRAMES_TRIGGER  = 5;     // stable frames before firing scan (~750ms)
const MOTION_THRESH   = 22;    // avg pixel diff considered "still" (raised: 12 was too strict for hand-held)
const COOLDOWN_MS     = 1800;  // pause after a failed scan

export default function Scanner({
  decks: initialDecks,
  tier,
  scanCount: initialScanCount,
  initialMode = 'Scan',
  initialDeckId,
  userId,
}) {
  const normaliseMode = (m) => {
    if (m === 'Live Scan' || m === 'Photo') return 'Scan';
    return MODES.includes(m) ? m : 'Scan';
  };

  // ── Core state ───────────────────────────────────────
  const [mode, setMode]                 = useState(normaliseMode(initialMode));
  const [decks, setDecks]               = useState(initialDecks);
  const [activeDeckId, setActiveDeckId] = useState(initialDeckId || initialDecks[0]?.id || NEW_DECK);
  const [result, setResult]             = useState(null);
  const [scanning, setScanning]         = useState(false);
  const [scanCount, setScanCount]       = useState(initialScanCount);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [cameraReady, setCameraReady]   = useState(false);
  const [cameraError, setCameraError]   = useState('');
  const [isOnline, setIsOnline]         = useState(true);
  const [scanState, setScanState]       = useState('idle'); // idle | stable | scanning | cooldown

  // ── Search state ─────────────────────────────────────
  const [searchName, setSearchName]           = useState('');
  const [filterColors, setFilterColors]       = useState([]);
  const [filterType, setFilterType]           = useState('');
  const [filterCmc, setFilterCmc]             = useState('');
  const [filterRarity, setFilterRarity]       = useState('');
  const [searchResults, setSearchResults]     = useState([]);
  const [searchLoading, setSearchLoading]     = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // ── New-deck form state ───────────────────────────────
  const [showNewDeckForm, setShowNewDeckForm] = useState(false);
  const [newDeckName, setNewDeckName]         = useState('');
  const [newDeckFormat, setNewDeckFormat]     = useState('commander');
  const [creatingDeck, setCreatingDeck]       = useState(false);
  const [formHasCard, setFormHasCard]         = useState(false);

  // ── DOM refs ─────────────────────────────────────────
  const videoRef         = useRef(null);
  const streamRef        = useRef(null);
  const canvasRef        = useRef(null);
  const pendingCardRef   = useRef(null);
  const searchDebounceRef = useRef(null);

  // ── Auto-scan refs (avoid stale-closure issues) ───────
  const isScanningRef    = useRef(false);
  const inCooldownRef    = useRef(false);
  const hasResultRef     = useRef(false);
  const stableFramesRef  = useRef(0);
  const prevFrameRef     = useRef(null);
  const scanStateRef     = useRef('idle');
  const frameIntervalRef = useRef(null);
  const frameCheckCbRef  = useRef(null); // latest-callback-ref pattern
  const scanCountRef     = useRef(initialScanCount);
  const scanLimitRef     = useRef(tier === 'pro' ? Infinity : 25);
  const cameraReadyRef   = useRef(false);

  const supabase = createClient();
  const router   = useRouter();

  const scanLimit  = tier === 'pro' ? Infinity : 25;
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  const isNewDeck  = activeDeckId === NEW_DECK;

  // ── Keep refs in sync ────────────────────────────────
  useEffect(() => { scanCountRef.current = scanCount; }, [scanCount]);
  useEffect(() => { cameraReadyRef.current = cameraReady; }, [cameraReady]);
  useEffect(() => {
    hasResultRef.current = !!result;
    if (!result) {
      // Reset stability so the next card gets a clean start
      stableFramesRef.current = 0;
      prevFrameRef.current    = null;
    }
  }, [result]);

  // ── Online / offline ─────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Camera ───────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError('');
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setCameraError('Camera access denied — use gallery upload or switch to Search.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (mode === 'Scan' && isOnline) startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [mode, isOnline, startCamera, stopCamera]);

  // ── Scan-state helper (only re-renders when value changes) ──
  const updateScanState = useCallback((s) => {
    if (scanStateRef.current !== s) {
      scanStateRef.current = s;
      setScanState(s);
    }
  }, []);

  // ── Frame sampling ────────────────────────────────────
  const sampleCenter = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video?.videoWidth || !canvas) return null;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const cx = Math.floor(video.videoWidth  / 2);
    const cy = Math.floor(video.videoHeight / 2);
    return ctx.getImageData(cx - 40, cy - 30, 80, 60).data;
  };

  const captureFullFrame = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  };

  // ── Core scan function ────────────────────────────────
  const doScan = useCallback(async (fromBlob = null) => {
    if (isScanningRef.current || inCooldownRef.current || hasResultRef.current) return;
    if (scanCountRef.current >= scanLimitRef.current || !cameraReadyRef.current) return;

    isScanningRef.current = true;
    updateScanState('scanning');
    stableFramesRef.current = 0;
    prevFrameRef.current    = null;
    setScanning(true);

    try {
      const blob = fromBlob || await captureFullFrame();
      if (!blob) throw new Error('Capture failed');

      const formData = new FormData();
      formData.append('image', blob, 'scan.jpg');
      const res  = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.ok && data.card) {
        setResult(data.card);
        setScanCount((c) => c + 1);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        updateScanState('idle');
      } else {
        showToast(data.error || 'Card not recognized — try repositioning', 'error');
        inCooldownRef.current = true;
        updateScanState('cooldown');
        setTimeout(() => {
          inCooldownRef.current = false;
          updateScanState('idle');
        }, COOLDOWN_MS);
      }
    } catch {
      showToast('Scan failed — check your connection', 'error');
      inCooldownRef.current = true;
      updateScanState('cooldown');
      setTimeout(() => {
        inCooldownRef.current = false;
        updateScanState('idle');
      }, COOLDOWN_MS);
    } finally {
      setScanning(false);
      isScanningRef.current = false;
    }
  }, [updateScanState]);

  // Gallery upload
  const handleGalleryUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await doScan(file);
  };

  // ── Auto-scan: latest-callback-ref pattern ─────────────
  // This effect runs after every render so frameCheckCbRef always
  // holds fresh closures without the interval needing extra deps.
  useEffect(() => {
    frameCheckCbRef.current = () => {
      if (isScanningRef.current || inCooldownRef.current || hasResultRef.current) {
        stableFramesRef.current = 0;
        return;
      }

      const current = sampleCenter();
      if (!current) return;

      const prev = prevFrameRef.current;
      prevFrameRef.current = current;
      if (!prev) return;

      // Average absolute diff on R channel, every 4th pixel
      let diff = 0, n = 0;
      for (let i = 0; i < current.length; i += 16) {
        diff += Math.abs(current[i] - prev[i]);
        n++;
      }
      const avgDiff = n > 0 ? diff / n : 999;

      if (avgDiff < MOTION_THRESH) {
        stableFramesRef.current = Math.min(stableFramesRef.current + 1, FRAMES_TRIGGER);

        if (stableFramesRef.current >= FRAMES_TRIGGER) {
          doScan(); // 🚀 auto-fire
        } else if (stableFramesRef.current >= FRAMES_PREVIEW) {
          updateScanState('stable'); // show green cue
        }
      } else {
        // Motion — decay stability quickly
        stableFramesRef.current = Math.max(0, stableFramesRef.current - 2);
        if (stableFramesRef.current < FRAMES_PREVIEW) {
          updateScanState('idle');
        }
      }
    };
  }); // intentionally no deps — keeps cb fresh every render

  // Start / stop the frame-check interval
  useEffect(() => {
    if (mode !== 'Scan' || !cameraReady || !isOnline) {
      clearInterval(frameIntervalRef.current);
      stableFramesRef.current = 0;
      prevFrameRef.current    = null;
      return;
    }
    frameIntervalRef.current = setInterval(() => {
      frameCheckCbRef.current?.();
    }, FRAME_MS);
    return () => clearInterval(frameIntervalRef.current);
  }, [mode, cameraReady, isOnline]);

  // ── Search ────────────────────────────────────────────
  const runSearch = useCallback(async (name, colors, cardType, cmc, rarity) => {
    const query = buildScryfallQuery({ name, colors, cardType, cmc, rarity });
    if (!query) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res  = await fetch(`/api/scryfall/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch { setSearchResults([]); }
    setSearchLoading(false);
  }, []);

  useEffect(() => {
    if (mode !== 'Search') return;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      runSearch(searchName, filterColors, filterType, filterCmc, filterRarity);
    }, 350);
    return () => clearTimeout(searchDebounceRef.current);
  }, [mode, searchName, filterColors, filterType, filterCmc, filterRarity, runSearch]);

  const toggleColor  = (c) => setFilterColors((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);
  const toggleRarity = (r) => setFilterRarity((p) => p === r ? '' : r);

  // ── Deck / card ops ───────────────────────────────────
  const createNewDeck = async (name, format) => {
    setCreatingDeck(true);
    const { data, error } = await supabase
      .from('decks')
      .insert({ user_id: userId, name: name.trim(), format, card_count: 0 })
      .select().single();
    setCreatingDeck(false);
    if (error || !data) { showToast('Failed to create deck', 'error'); return null; }
    setDecks((prev) => [data, ...prev]);
    setActiveDeckId(data.id);
    return data;
  };

  const doAddCard = async (card, deckId) => {
    const { data: existing, error: selErr } = await supabase
      .from('deck_cards').select('id, quantity')
      .eq('deck_id', deckId).eq('scryfall_id', card.scryfall_id).maybeSingle();
    if (selErr) { showToast('Failed to check deck: ' + selErr.message, 'error'); return false; }
    if (existing) {
      const { error } = await supabase.from('deck_cards')
        .update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
      if (error) { showToast('Failed to update card: ' + error.message, 'error'); return false; }
    } else {
      const { error } = await supabase.from('deck_cards').insert({
        deck_id: deckId, scryfall_id: card.scryfall_id,
        card_name: card.card_name, quantity: 1,
        is_commander: false, is_partner: false,
      });
      if (error) { showToast('Failed to add card: ' + error.message, 'error'); return false; }
    }
    const targetDeck = decks.find((d) => d.id === deckId);
    showToast(`✓ ${card.card_name} added to ${targetDeck?.name || 'deck'}`, 'success');
    if (navigator.vibrate) navigator.vibrate(50);
    setResult(null);
    return true;
  };

  const addCardToDeck = async (card, deckId) => {
    if (deckId === NEW_DECK || !deckId) {
      pendingCardRef.current = card;
      setFormHasCard(true);
      setShowNewDeckForm(true);
      return;
    }
    await doAddCard(card, deckId);
  };

  const handleNewDeckSubmit = async (e) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    const newDeck = await createNewDeck(newDeckName, newDeckFormat);
    if (newDeck) {
      const pending = pendingCardRef.current;
      pendingCardRef.current = null;
      if (pending) {
        await doAddCard(pending, newDeck.id);
      } else {
        showToast(`✓ "${newDeck.name}" created — ready to add cards`, 'success');
      }
    }
    setShowNewDeckForm(false);
    setNewDeckName('');
  };

  // ── Viewfinder appearance ─────────────────────────────
  const vfColor =
    scanState === 'scanning' ? '#f59e0b' :
    scanState === 'stable'   ? '#10b981' :
    scanState === 'cooldown' ? 'rgba(255,255,255,0.15)' :
    'rgba(255,255,255,0.35)';

  const vfGlow =
    scanState === 'scanning' ? '0 0 0 1px rgba(245,158,11,0.3), 0 0 32px rgba(245,158,11,0.35)' :
    scanState === 'stable'   ? '0 0 0 1px rgba(16,185,129,0.4), 0 0 28px rgba(16,185,129,0.45)' :
    'none';

  const vfText =
    scanState === 'scanning' ? 'Identifying card…' :
    scanState === 'stable'   ? 'Hold still…' :
    scanState === 'cooldown' ? 'Trying again shortly…' :
    scanCount >= scanLimit   ? '' :
    'Hold card steady · tap to scan';

  const vfTextColor =
    scanState === 'scanning' ? '#f59e0b' :
    scanState === 'stable'   ? '#10b981' :
    scanState === 'cooldown' ? 'rgba(255,255,255,0.25)' :
    'rgba(255,255,255,0.5)';

  // ── Shared top bar ────────────────────────────────────
  const TopBar = () => (
    <>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setShowDeckPicker(!showDeckPicker)}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
          style={{ background: mode === 'Scan' ? 'rgba(17,24,39,0.92)' : '#111827', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 36 }}
        >
          <span>{isNewDeck ? '✨' : '📦'}</span>
          <span className="truncate" style={{ maxWidth: 140 }}>
            {isNewDeck ? 'New Deck' : (activeDeck?.name || 'Select Deck')}
          </span>
          <span style={{ color: '#94a3b8' }}>▾</span>
        </button>
        {tier === 'free' && (
          <div
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: scanCount >= scanLimit - 3
                ? 'rgba(239,68,68,0.9)'
                : mode === 'Scan' ? 'rgba(17,24,39,0.92)' : '#111827',
              color: '#f1f5f9', border: '1px solid #1e2d47',
            }}
          >
            {scanCount}/{scanLimit}
          </div>
        )}
      </div>

      {showDeckPicker && (
        <div
          className="rounded-xl overflow-hidden mb-2 max-h-56 overflow-y-auto"
          style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 20, position: 'relative' }}
        >
          <button
            onClick={() => { setShowDeckPicker(false); pendingCardRef.current = null; setFormHasCard(false); setShowNewDeckForm(true); }}
            className="w-full text-left px-4 py-3 text-sm flex items-center gap-2 font-medium"
            style={{ color: '#a78bfa', borderBottom: '1px solid #1e2d47', minHeight: 44, background: 'transparent' }}
          >
            ✨ Create New Deck
          </button>
          {decks.map((deck) => (
            <button
              key={deck.id}
              onClick={() => { setActiveDeckId(deck.id); setShowDeckPicker(false); }}
              className="w-full text-left px-4 py-3 text-sm flex items-center gap-2"
              style={{
                color: deck.id === activeDeckId ? '#f59e0b' : '#f1f5f9',
                borderBottom: '1px solid #1e2d47', minHeight: 44,
                background: deck.id === activeDeckId ? 'rgba(245,158,11,0.1)' : 'transparent',
              }}
            >
              {deck.id === activeDeckId && '✓ '}{deck.name}
              <span
                className="ml-auto text-xs rounded-full px-2 py-0.5"
                style={{ background: deck.format === 'commander' ? '#7c3aed' : '#1a2235', color: '#f1f5f9' }}
              >
                {deck.format === 'commander' ? 'CMD' : '60'}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        className="flex rounded-xl p-1"
        style={{ background: mode === 'Scan' ? 'rgba(17,24,39,0.92)' : '#111827', border: '1px solid #1e2d47' }}
      >
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setResult(null); setSearchResults([]); setSearchName(''); }}
            className="flex-1 py-2 text-xs font-semibold rounded-lg transition-all"
            style={{
              background: mode === m ? '#f59e0b' : 'transparent',
              color: mode === m ? '#0a0e1a' : '#94a3b8',
              minHeight: 36,
            }}
          >
            {m === 'Scan' ? '📷 Scan' : '🔍 Search'}
          </button>
        ))}
      </div>
    </>
  );

  // ─────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#000' }}>

      {/* ══════════════ SCAN MODE ══════════════ */}
      {mode === 'Scan' && (
        <>
          <video
            ref={videoRef}
            playsInline muted autoPlay
            className="absolute inset-0 w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Camera denied */}
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center p-6" style={{ background: '#0a0e1a' }}>
              <div className="text-center">
                <div className="text-5xl mb-4">📷</div>
                <p className="text-white font-semibold mb-2">Camera access needed</p>
                <p className="text-slate-400 text-sm mb-5">{cameraError}</p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={startCamera}
                    className="rounded-xl px-6 py-3 text-sm font-semibold"
                    style={{ background: '#f59e0b', color: '#0a0e1a' }}
                  >
                    Try Again
                  </button>
                  <label
                    className="rounded-xl px-6 py-3 text-sm font-semibold text-center cursor-pointer"
                    style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9' }}
                  >
                    🖼️ Upload from Gallery
                    <input type="file" accept="image/*" onChange={handleGalleryUpload} disabled={scanning} className="hidden" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Offline */}
          {!isOnline && (
            <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/80">
              <div className="text-center">
                <div className="text-5xl mb-4">📡</div>
                <p className="text-white font-semibold">Scanning requires internet</p>
              </div>
            </div>
          )}

          {/* ── Viewfinder & controls ── */}
          {!cameraError && isOnline && !result && (
            <>
              {/* Targeting rectangle — pointer-events-none so taps fall through to the scan btn */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div style={{ position: 'relative', width: 280, height: 190 }}>

                  {/* Outer glow border */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    border: `2px solid ${vfColor}`,
                    borderRadius: 12,
                    boxShadow: vfGlow,
                    transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
                  }} />

                  {/* Corner accents */}
                  {[
                    { top: -2,    left: -2,  borderTop: true,    borderLeft: true,  radius: '5px 0 0 0' },
                    { top: -2,    right: -2, borderTop: true,    borderRight: true, radius: '0 5px 0 0' },
                    { bottom: -2, left: -2,  borderBottom: true, borderLeft: true,  radius: '0 0 0 5px' },
                    { bottom: -2, right: -2, borderBottom: true, borderRight: true, radius: '0 0 5px 0' },
                  ].map((c, i) => (
                    <div key={i} style={{
                      position: 'absolute',
                      width: 24, height: 24,
                      top: c.top, bottom: c.bottom, left: c.left, right: c.right,
                      borderTop:    c.borderTop    ? `3px solid ${vfColor}` : 'none',
                      borderBottom: c.borderBottom ? `3px solid ${vfColor}` : 'none',
                      borderLeft:   c.borderLeft   ? `3px solid ${vfColor}` : 'none',
                      borderRight:  c.borderRight  ? `3px solid ${vfColor}` : 'none',
                      borderRadius: c.radius,
                      transition: 'border-color 0.25s ease',
                    }} />
                  ))}

                  {/* Scanning spinner overlay */}
                  {scanState === 'scanning' && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 10,
                      background: 'rgba(0,0,0,0.2)',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        border: '3px solid rgba(245,158,11,0.25)',
                        borderTopColor: '#f59e0b',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                    </div>
                  )}
                </div>

                {/* Status label */}
                <p style={{
                  marginTop: 14,
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: '0.01em',
                  color: vfTextColor,
                  transition: 'color 0.25s ease',
                }}>
                  {vfText}
                </p>
              </div>

              {/* Bottom controls */}
              <div
                className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 px-6 pb-6 pt-4"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)' }}
              >
                {/* Gallery upload */}
                <label
                  className="flex items-center justify-center rounded-full cursor-pointer transition-all active:scale-95 flex-shrink-0"
                  style={{
                    width: 54, height: 54,
                    background: 'rgba(17,24,39,0.92)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    fontSize: 22,
                  }}
                  title="Upload from gallery"
                >
                  🖼️
                  <input
                    type="file" accept="image/*"
                    onChange={handleGalleryUpload}
                    disabled={scanning}
                    className="hidden"
                  />
                </label>

                {/* Scan button — manual override or visual confirmation */}
                <button
                  onPointerDown={() => doScan()}
                  disabled={scanning || scanCount >= scanLimit || !cameraReady}
                  className="flex items-center gap-2 rounded-full font-bold text-sm disabled:opacity-50 transition-all active:scale-95 flex-shrink-0"
                  style={{
                    paddingLeft: 28, paddingRight: 28, height: 56,
                    minWidth: 170, justifyContent: 'center',
                    background:
                      scanState === 'stable'   ? '#10b981' :
                      scanState === 'scanning' ? 'rgba(245,158,11,0.55)' :
                      '#f59e0b',
                    color: '#0a0e1a',
                    boxShadow:
                      scanState === 'stable' ? '0 4px 24px rgba(16,185,129,0.55)' :
                      '0 4px 20px rgba(245,158,11,0.4)',
                    transition: 'background 0.25s ease, box-shadow 0.25s ease',
                  }}
                >
                  {scanState === 'scanning' ? (
                    <>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%',
                        border: '2px solid rgba(10,14,26,0.4)',
                        borderTopColor: '#0a0e1a',
                        animation: 'spin 0.8s linear infinite',
                        flexShrink: 0,
                      }} />
                      Scanning…
                    </>
                  ) : scanState === 'stable' ? (
                    '✨ Auto-scanning…'
                  ) : (
                    '⚡ Tap to Scan'
                  )}
                </button>
              </div>
            </>
          )}

          {/* Top bar gradient overlay */}
          <div
            className="absolute top-0 left-0 right-0 px-4 pt-4 pb-2 z-10"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.78) 0%, transparent 100%)' }}
          >
            <TopBar />
          </div>
        </>
      )}

      {/* ══════════════ SEARCH MODE ══════════════ */}
      {mode === 'Search' && (
        <div className="absolute inset-0 flex flex-col" style={{ background: '#0a0e1a' }}>
          <div
            className="flex-shrink-0 px-4 pt-4 pb-3"
            style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2d47' }}
          >
            <TopBar />
          </div>

          <div
            className="flex-shrink-0 px-4 pt-3 pb-2"
            style={{ background: '#0a0e1a', borderBottom: '1px solid rgba(30,45,71,0.6)' }}
          >
            <div className="relative mb-3">
              <input
                type="text" value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="Card name…"
                autoFocus
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: '#111827', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
              />
              {searchLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#f59e0b', borderTopColor: 'transparent' }} />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs flex-shrink-0" style={{ color: '#64748b', minWidth: 36 }}>Color</span>
              <div className="flex gap-1.5">
                {Object.entries(COLOR_LABELS).map(([c, label]) => {
                  const active = filterColors.includes(c);
                  const st = COLOR_STYLES[c];
                  return (
                    <button key={c} onClick={() => toggleColor(c)}
                      className="rounded-full text-xs font-bold transition-all active:scale-95"
                      style={{
                        width: 32, height: 32, flexShrink: 0, fontSize: 16,
                        background: active ? st.bg  : 'rgba(30,45,71,0.6)',
                        color:      active ? st.text : '#64748b',
                        border: `2px solid ${active ? st.border : 'transparent'}`,
                      }}
                      title={c === 'C' ? 'Colorless' : c}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs flex-shrink-0" style={{ color: '#64748b', minWidth: 36 }}>Type</span>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                {TYPES.map((t) => (
                  <button key={t} onClick={() => setFilterType(filterType === t ? '' : t)}
                    className="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-all active:scale-95 flex-shrink-0"
                    style={{
                      background: filterType === t ? '#f59e0b' : 'rgba(30,45,71,0.6)',
                      color:      filterType === t ? '#0a0e1a' : '#94a3b8',
                      border: `1px solid ${filterType === t ? '#f59e0b' : 'transparent'}`,
                      minHeight: 28,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowMoreFilters(!showMoreFilters)}
              className="text-xs mb-1"
              style={{ color: showMoreFilters ? '#f59e0b' : '#475569' }}
            >
              {showMoreFilters ? '▾ Less filters' : '▸ CMC & Rarity filters'}
            </button>

            {showMoreFilters && (
              <div className="flex gap-4 mt-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: '#64748b' }}>CMC</span>
                  <div className="flex gap-1">
                    {['', '0', '1', '2', '3', '4', '5', '6', '7+'].map((v) => (
                      <button key={v} onClick={() => setFilterCmc(filterCmc === v ? '' : v)}
                        className="rounded-lg text-xs font-medium transition-all"
                        style={{
                          width: 28, height: 28, flexShrink: 0,
                          background: filterCmc === v ? '#f59e0b' : 'rgba(30,45,71,0.6)',
                          color:      filterCmc === v ? '#0a0e1a' : '#94a3b8',
                          border: `1px solid ${filterCmc === v ? '#f59e0b' : 'transparent'}`,
                        }}
                      >
                        {v === '' ? 'Any' : v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: '#64748b' }}>Rarity</span>
                  <div className="flex gap-1.5">
                    {RARITIES.map((r) => (
                      <button key={r.key} onClick={() => toggleRarity(r.key)}
                        className="rounded-lg text-xs font-bold transition-all"
                        style={{
                          width: 28, height: 28, flexShrink: 0,
                          background: filterRarity === r.key ? r.color : 'rgba(30,45,71,0.6)',
                          color:      filterRarity === r.key ? '#0a0e1a' : r.color,
                          border: `1px solid ${filterRarity === r.key ? r.color : 'transparent'}`,
                        }}
                        title={r.title}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {!searchLoading && searchResults.length === 0 && (searchName || filterColors.length || filterType || filterCmc || filterRarity) && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <div className="text-4xl mb-3">🔍</div>
                <p className="text-sm" style={{ color: '#64748b' }}>No cards found — try adjusting filters</p>
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && !searchName && !filterColors.length && !filterType && !filterCmc && !filterRarity && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <div className="text-4xl mb-3">🃏</div>
                <p className="text-sm" style={{ color: '#64748b' }}>Search by name, color, type, CMC or rarity</p>
              </div>
            )}
            {searchResults.map((card) => (
              <button
                key={card.scryfall_id}
                onClick={() => setResult(card)}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors active:bg-white/5"
                style={{ borderBottom: '1px solid rgba(30,45,71,0.5)', minHeight: 60 }}
              >
                {card.image_uri && (
                  <img src={card.image_uri} alt="" className="rounded flex-shrink-0" style={{ width: 32, height: 45, objectFit: 'cover' }} />
                )}
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium text-white truncate">{card.card_name}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: '#64748b' }}>
                    {card.type_line?.split('—')[0]?.trim()}
                    {card.cmc != null ? ` · CMC ${card.cmc}` : ''}
                    {card.set_name ? ` · ${card.set_name}` : ''}
                  </div>
                </div>
                {card.price_eur != null && (
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#10b981' }}>
                    €{parseFloat(card.price_eur).toFixed(2)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Scan limit overlay ── */}
      {tier === 'free' && scanCount >= scanLimit && mode === 'Scan' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/70 z-20">
          <div className="rounded-2xl p-6 text-center max-w-xs" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <div className="text-4xl mb-3">🚫</div>
            <h3 className="font-bold text-white mb-2">Monthly limit reached</h3>
            <p className="text-slate-400 text-sm mb-4">You've used all 25 free scans this month.</p>
            <button
              onClick={() => router.push('/profile')}
              className="w-full rounded-xl py-3 font-semibold text-sm"
              style={{ background: '#f59e0b', color: '#0a0e1a' }}
            >
              Upgrade to Pro
            </button>
          </div>
        </div>
      )}

      {/* ── Card result sheet ── */}
      {result && (
        <CardResultSheet
          card={result}
          decks={decks}
          activeDeckId={isNewDeck ? null : activeDeckId}
          onAdd={addCardToDeck}
          onDismiss={() => setResult(null)}
        />
      )}

      {/* ── New deck form ── */}
      {showNewDeckForm && (
        <div
          className="absolute inset-0 flex items-end z-30"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewDeckForm(false); }}
        >
          <div className="w-full rounded-t-2xl px-4 pt-4 pb-8" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">Create New Deck</h2>
            <p className="text-slate-400 text-sm mb-4">
              {formHasCard ? 'The card will be added once the deck is created.' : 'Give your deck a name and choose a format.'}
            </p>
            <form onSubmit={handleNewDeckSubmit} className="space-y-4">
              <input
                type="text" value={newDeckName} onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="e.g. Atraxa Superfriends" required autoFocus
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
              />
              <div className="flex gap-3">
                {[
                  { value: 'commander', label: 'Commander', desc: '100-card' },
                  { value: '60card',    label: '60-Card',   desc: 'Standard/Modern' },
                ].map((f) => (
                  <button
                    type="button" key={f.value}
                    onClick={() => setNewDeckFormat(f.value)}
                    className="flex-1 rounded-xl p-3 text-sm text-left transition-all"
                    style={{
                      background: newDeckFormat === f.value ? 'rgba(245,158,11,0.15)' : '#1a2235',
                      border: `1px solid ${newDeckFormat === f.value ? '#f59e0b' : '#1e2d47'}`,
                      color: newDeckFormat === f.value ? '#f59e0b' : '#94a3b8',
                      minHeight: 60,
                    }}
                  >
                    <div className="font-semibold">{f.label}</div>
                    <div className="text-xs mt-0.5 opacity-70">{f.desc}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => setShowNewDeckForm(false)}
                  className="flex-1 rounded-xl py-3 text-sm font-medium"
                  style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={creatingDeck || !newDeckName.trim()}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
                >
                  {creatingDeck ? 'Creating…' : formHasCard ? 'Create & Add Card' : 'Create Deck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
