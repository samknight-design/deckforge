'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { showToast } from './Toast';
import CardResultSheet from './CardResultSheet';

const MODES = ['Scan', 'Search'];
const NEW_DECK = '__new__';

export default function Scanner({ decks: initialDecks, tier, scanCount: initialScanCount, initialMode = 'Scan', initialDeckId, userId }) {
  // Normalise legacy 'Live Scan' / 'Photo' values from URL params
  const normaliseMode = (m) => {
    if (m === 'Live Scan' || m === 'Photo') return 'Scan';
    if (MODES.includes(m)) return m;
    return 'Scan';
  };

  const [mode, setMode] = useState(normaliseMode(initialMode));
  const [decks, setDecks] = useState(initialDecks);
  const [activeDeckId, setActiveDeckId] = useState(initialDeckId || initialDecks[0]?.id || NEW_DECK);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(initialScanCount);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  // New deck creation
  const [showNewDeckForm, setShowNewDeckForm] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckFormat, setNewDeckFormat] = useState('commander');
  const [creatingDeck, setCreatingDeck] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const galleryInputRef = useRef(null);
  const pendingCardRef = useRef(null);
  const supabase = createClient();
  const router = useRouter();

  const scanLimit = tier === 'pro' ? Infinity : 100;
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  const isNewDeck = activeDeckId === NEW_DECK;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
      setCameraError('Camera access denied. Tap "Try Again" or use gallery upload below.');
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
    if (mode === 'Scan' && isOnline) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [mode, isOnline, startCamera, stopCamera]);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  }, []);

  const submitImageForScan = useCallback(async (blob) => {
    if (scanning || scanCount >= scanLimit) return;
    setScanning(true);
    try {
      const formData = new FormData();
      formData.append('image', blob, 'scan.jpg');
      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.card) {
        setResult(data.card);
        setScanCount((c) => c + 1);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      } else {
        showToast(data.error || 'Card not recognized', 'error');
      }
    } catch {
      showToast('Scan failed — check your connection', 'error');
    } finally {
      setScanning(false);
    }
  }, [scanning, scanCount, scanLimit]);

  // Live camera tap-to-scan
  const handleTapScan = useCallback(async () => {
    if (scanning || scanCount >= scanLimit || !cameraReady) return;
    const blob = await captureFrame();
    if (blob) await submitImageForScan(blob);
  }, [scanning, scanCount, scanLimit, cameraReady, captureFrame, submitImageForScan]);

  // Gallery / file upload
  const handleGalleryUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected if needed
    e.target.value = '';
    await submitImageForScan(file);
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSuggestions([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/scryfall/autocomplete?q=${encodeURIComponent(query)}`);
      setSuggestions((await res.json()).slice(0, 8));
    } catch { setSuggestions([]); }
    setSearchLoading(false);
  };

  const handleSelectSearchCard = async (name) => {
    setSuggestions([]);
    setSearchQuery(name);
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/scryfall/card?name=${encodeURIComponent(name)}`);
      if (res.ok) setResult(await res.json());
      else showToast('Card not found', 'error');
    } catch { showToast('Search failed', 'error'); }
    setSearchLoading(false);
  };

  const createNewDeck = async (name, format) => {
    setCreatingDeck(true);
    const { data, error } = await supabase
      .from('decks')
      .insert({ user_id: userId, name: name.trim(), format, card_count: 0 })
      .select()
      .single();
    setCreatingDeck(false);
    if (error || !data) { showToast('Failed to create deck', 'error'); return null; }
    setDecks((prev) => [data, ...prev]);
    setActiveDeckId(data.id);
    return data;
  };

  const doAddCard = async (card, deckId) => {
    const { data: existing, error: selectErr } = await supabase
      .from('deck_cards')
      .select('id, quantity')
      .eq('deck_id', deckId)
      .eq('scryfall_id', card.scryfall_id)
      .maybeSingle();

    if (selectErr) { showToast('Failed to check deck: ' + selectErr.message, 'error'); return false; }

    if (existing) {
      const { error } = await supabase
        .from('deck_cards')
        .update({ quantity: existing.quantity + 1 })
        .eq('id', existing.id);
      if (error) { showToast('Failed to update card: ' + error.message, 'error'); return false; }
    } else {
      const { error } = await supabase.from('deck_cards').insert({
        deck_id: deckId,
        scryfall_id: card.scryfall_id,
        card_name: card.card_name,
        quantity: 1,
        is_commander: false,
        is_partner: false,
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
      setShowNewDeckForm(true);
      return;
    }
    await doAddCard(card, deckId);
  };

  const handleNewDeckSubmit = async (e) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    const newDeck = await createNewDeck(newDeckName, newDeckFormat);
    if (newDeck && pendingCardRef.current) {
      await doAddCard(pendingCardRef.current, newDeck.id);
      pendingCardRef.current = null;
    }
    setShowNewDeckForm(false);
    setNewDeckName('');
  };

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#000' }}>

      {/* ── SCAN MODE ── */}
      {mode === 'Scan' && (
        <>
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />

          {/* Hidden gallery input */}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handleGalleryUpload}
            className="hidden"
          />

          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center p-6" style={{ background: '#0a0e1a' }}>
              <div className="text-center">
                <div className="text-5xl mb-4">📷</div>
                <p className="text-white font-semibold mb-2">Camera needed</p>
                <p className="text-slate-400 text-sm mb-5">{cameraError}</p>
                <div className="flex flex-col gap-3">
                  <button onClick={startCamera} className="rounded-xl px-6 py-3 text-sm font-semibold" style={{ background: '#f59e0b', color: '#0a0e1a' }}>
                    Try Camera Again
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

          {!isOnline && (
            <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/80">
              <div className="text-center">
                <div className="text-5xl mb-4">📡</div>
                <p className="text-white font-semibold">Scanning requires internet</p>
              </div>
            </div>
          )}

          {/* Viewfinder frame */}
          {!cameraError && isOnline && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div
                style={{
                  width: 260,
                  height: 180,
                  border: `2px solid ${scanning ? '#f59e0b' : 'rgba(245,158,11,0.55)'}`,
                  borderRadius: 12,
                  boxShadow: scanning ? '0 0 24px rgba(245,158,11,0.35)' : 'none',
                  transition: 'all 0.25s',
                }}
              />
              <p className="text-xs mt-3 font-medium" style={{ color: 'rgba(245,158,11,0.85)' }}>
                {scanning ? 'Identifying card…' : 'Frame the card name, then tap Scan'}
              </p>
            </div>
          )}

          {/* Bottom action bar: Gallery icon + Scan button */}
          {!cameraError && isOnline && !result && (
            <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-4 px-6">
              {/* Gallery upload button */}
              <label
                className="flex items-center justify-center rounded-full cursor-pointer transition-all active:scale-95"
                style={{
                  width: 52,
                  height: 52,
                  background: 'rgba(17,24,39,0.92)',
                  border: '1px solid rgba(245,158,11,0.4)',
                  fontSize: 22,
                  flexShrink: 0,
                }}
                title="Upload from gallery"
              >
                🖼️
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleGalleryUpload}
                  disabled={scanning}
                  className="hidden"
                />
              </label>

              {/* Tap to scan */}
              <button
                onPointerDown={handleTapScan}
                disabled={scanning || scanCount >= scanLimit || !cameraReady}
                className="flex items-center gap-2 rounded-full px-8 py-4 font-bold text-sm disabled:opacity-50 transition-all active:scale-95"
                style={{
                  background: scanning ? 'rgba(245,158,11,0.5)' : '#f59e0b',
                  color: '#0a0e1a',
                  minWidth: 170,
                  justifyContent: 'center',
                  boxShadow: '0 4px 20px rgba(245,158,11,0.4)',
                  flexShrink: 0,
                }}
              >
                {scanning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Scanning…
                  </>
                ) : (
                  '⚡ Scan Card'
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── SEARCH MODE ── */}
      {mode === 'Search' && (
        <div className="absolute inset-0 p-4 pt-24 overflow-y-auto" style={{ background: '#0a0e1a' }}>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search card name…"
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
              style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
            />
            {searchLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 rounded-xl overflow-hidden" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
              {suggestions.map((name, i) => (
                <button key={i} onClick={() => handleSelectSearchCard(name)}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-opacity-80 transition-colors"
                  style={{ color: '#f1f5f9', borderBottom: i < suggestions.length - 1 ? '1px solid #1e2d47' : 'none', minHeight: 44 }}>
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div
        className="absolute top-0 left-0 right-0 px-4 pt-4 pb-2 z-10"
        style={{ background: mode === 'Scan' ? 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)' : 'transparent' }}
      >
        {/* Deck selector */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowDeckPicker(!showDeckPicker)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: 'rgba(17,24,39,0.92)', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 36 }}
          >
            <span>{isNewDeck ? '✨' : '📦'}</span>
            <span className="max-w-36 truncate">{isNewDeck ? 'New Deck' : (activeDeck?.name || 'Select Deck')}</span>
            <span style={{ color: '#94a3b8' }}>▾</span>
          </button>
          {tier === 'free' && (
            <div className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: scanCount >= 80 ? 'rgba(239,68,68,0.9)' : 'rgba(17,24,39,0.92)', color: '#f1f5f9', border: '1px solid #1e2d47' }}>
              {scanCount}/{scanLimit}
            </div>
          )}
        </div>

        {/* Deck picker dropdown */}
        {showDeckPicker && (
          <div className="rounded-xl overflow-hidden mb-2 max-h-56 overflow-y-auto" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <button onClick={() => { setActiveDeckId(NEW_DECK); setShowDeckPicker(false); }}
              className="w-full text-left px-4 py-3 text-sm flex items-center gap-2"
              style={{ color: isNewDeck ? '#f59e0b' : '#a78bfa', borderBottom: '1px solid #1e2d47', minHeight: 44, background: isNewDeck ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
              {isNewDeck && '✓ '}✨ Create New Deck
            </button>
            {decks.map((deck) => (
              <button key={deck.id} onClick={() => { setActiveDeckId(deck.id); setShowDeckPicker(false); }}
                className="w-full text-left px-4 py-3 text-sm flex items-center gap-2"
                style={{ color: deck.id === activeDeckId ? '#f59e0b' : '#f1f5f9', borderBottom: '1px solid #1e2d47', minHeight: 44, background: deck.id === activeDeckId ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
                {deck.id === activeDeckId && '✓ '}
                {deck.name}
                <span className="ml-auto text-xs rounded-full px-2 py-0.5" style={{ background: deck.format === 'commander' ? '#7c3aed' : '#1a2235', color: '#f1f5f9' }}>
                  {deck.format === 'commander' ? 'CMD' : '60'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex rounded-xl p-1" style={{ background: 'rgba(17,24,39,0.92)', border: '1px solid #1e2d47' }}>
          {MODES.map((m) => (
            <button key={m} onClick={() => { setMode(m); setResult(null); setSuggestions([]); setSearchQuery(''); }}
              className="flex-1 py-2 text-xs font-semibold rounded-lg transition-all"
              style={{ background: mode === m ? '#f59e0b' : 'transparent', color: mode === m ? '#0a0e1a' : '#94a3b8', minHeight: 36 }}>
              {m === 'Scan' ? '📷 Scan' : '🔍 Search'}
            </button>
          ))}
        </div>
      </div>

      {/* Scan limit overlay (Pro upsell) */}
      {tier === 'free' && scanCount >= scanLimit && (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/70 z-20">
          <div className="rounded-2xl p-6 text-center max-w-xs" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <div className="text-4xl mb-3">🚫</div>
            <h3 className="font-bold text-white mb-2">Monthly limit reached</h3>
            <p className="text-slate-400 text-sm mb-4">You've used all 100 free scans this month.</p>
            <button onClick={() => router.push('/profile')} className="w-full rounded-xl py-3 font-semibold text-sm" style={{ background: '#f59e0b', color: '#0a0e1a' }}>
              Upgrade to Pro
            </button>
          </div>
        </div>
      )}

      {/* Card result sheet */}
      {result && (
        <CardResultSheet
          card={result}
          decks={decks}
          activeDeckId={isNewDeck ? null : activeDeckId}
          onAdd={addCardToDeck}
          onDismiss={() => setResult(null)}
        />
      )}

      {/* New deck form */}
      {showNewDeckForm && (
        <div className="absolute inset-0 flex items-end z-30" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewDeckForm(false); }}>
          <div className="w-full rounded-t-2xl px-4 pt-4 pb-8" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <div className="flex justify-center mb-4"><div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} /></div>
            <h2 className="text-lg font-bold text-white mb-1">Name Your New Deck</h2>
            <p className="text-slate-400 text-sm mb-4">The card will be added automatically once created.</p>
            <form onSubmit={handleNewDeckSubmit} className="space-y-4">
              <input type="text" value={newDeckName} onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="e.g. Atraxa Superfriends" required autoFocus
                className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }} />
              <div className="flex gap-3">
                {[{ value: 'commander', label: 'Commander', desc: '100-card' }, { value: '60card', label: '60-Card', desc: 'Standard/Modern' }].map((f) => (
                  <button type="button" key={f.value} onClick={() => setNewDeckFormat(f.value)}
                    className="flex-1 rounded-xl p-3 text-sm text-left transition-all"
                    style={{ background: newDeckFormat === f.value ? 'rgba(245,158,11,0.15)' : '#1a2235', border: `1px solid ${newDeckFormat === f.value ? '#f59e0b' : '#1e2d47'}`, color: newDeckFormat === f.value ? '#f59e0b' : '#94a3b8', minHeight: 60 }}>
                    <div className="font-semibold">{f.label}</div>
                    <div className="text-xs mt-0.5 opacity-70">{f.desc}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowNewDeckForm(false)}
                  className="flex-1 rounded-xl py-3 text-sm font-medium"
                  style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}>
                  Cancel
                </button>
                <button type="submit" disabled={creatingDeck || !newDeckName.trim()}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}>
                  {creatingDeck ? 'Creating…' : 'Create & Add Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
