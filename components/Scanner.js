'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import CardResultSheet from './CardResultSheet';

const MODES = ['Live Scan', 'Photo', 'Search'];

export default function Scanner({ decks, tier, scanCount: initialScanCount }) {
  const [mode, setMode] = useState('Live Scan');
  const [activeDeckId, setActiveDeckId] = useState(decks[0]?.id || null);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(initialScanCount);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [cooldown, setCooldown] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const supabase = createClient();

  const scanLimit = tier === 'pro' ? Infinity : 100;
  const activeDeck = decks.find((d) => d.id === activeDeckId);

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      setCameraError('Camera access denied. Please allow camera permissions.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (mode === 'Live Scan' && isOnline) {
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
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    });
  }, []);

  const submitScan = useCallback(async (blob) => {
    if (!blob || scanning || cooldown) return;
    if (scanCount >= scanLimit) return;

    setScanning(true);
    try {
      const formData = new FormData();
      formData.append('image', blob, 'scan.jpg');
      if (activeDeckId) formData.append('deckId', activeDeckId);

      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.ok && data.card) {
        setResult(data.card);
        setScanCount((c) => c + 1);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        setCooldown(true);
        setTimeout(() => setCooldown(false), 3000);
      }
    } catch (err) {
      // Silent fail for live scan
    } finally {
      setScanning(false);
    }
  }, [scanning, cooldown, scanCount, scanLimit, activeDeckId]);

  // Live scan debounced interval
  useEffect(() => {
    if (mode !== 'Live Scan' || !isOnline) return;

    scanIntervalRef.current = setInterval(async () => {
      if (scanning || cooldown || result) return;
      const blob = await captureFrame();
      if (blob) submitScan(blob);
    }, 2500);

    return () => clearInterval(scanIntervalRef.current);
  }, [mode, isOnline, scanning, cooldown, result, captureFrame, submitScan]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      if (activeDeckId) formData.append('deckId', activeDeckId);

      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.ok && data.card) {
        setResult(data.card);
        setScanCount((c) => c + 1);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      } else {
        alert(data.error || 'Card not recognized');
      }
    } catch (err) {
      alert('Failed to scan photo');
    } finally {
      setScanning(false);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSuggestions([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/scryfall/autocomplete?q=${encodeURIComponent(query)}`);
      const names = await res.json();
      setSuggestions(names.slice(0, 8));
    } catch { setSuggestions([]); }
    setSearchLoading(false);
  };

  const handleSelectSearchCard = async (name) => {
    setSuggestions([]);
    setSearchQuery(name);
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/scryfall/card?name=${encodeURIComponent(name)}`);
      const card = await res.json();
      if (res.ok) setResult(card);
    } catch {}
    setSearchLoading(false);
  };

  const addCardToDeck = async (card, deckId) => {
    if (!deckId) return;
    try {
      const { data: existing } = await supabase
        .from('deck_cards')
        .select('id, quantity')
        .eq('deck_id', deckId)
        .eq('scryfall_id', card.scryfall_id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('deck_cards')
          .update({ quantity: existing.quantity + 1 })
          .eq('id', existing.id);
      } else {
        await supabase.from('deck_cards').insert({
          deck_id: deckId,
          scryfall_id: card.scryfall_id,
          card_name: card.card_name,
          quantity: 1,
          is_commander: false,
          is_partner: false,
        });
      }
      setResult(null);
      if (navigator.vibrate) navigator.vibrate(50);
    } catch (err) {
      alert('Failed to add card');
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#000' }}>
      {/* Camera feed */}
      {mode === 'Live Scan' && (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="text-center">
                <div className="text-5xl mb-4">📷</div>
                <p className="text-text-secondary text-sm">{cameraError}</p>
              </div>
            </div>
          )}
          {!isOnline && (
            <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/80">
              <div className="text-center">
                <div className="text-5xl mb-4">📡</div>
                <p className="text-white font-semibold">Scanning requires internet</p>
                <p className="text-text-secondary text-sm mt-2">Connect to the internet to scan cards</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Scan frame overlay */}
      {mode === 'Live Scan' && isOnline && !cameraError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={scanning ? 'scan-pulse' : ''}
            style={{
              width: 240,
              height: 160,
              border: `2px solid ${scanning ? '#f59e0b' : 'rgba(245,158,11,0.6)'}`,
              borderRadius: 12,
              boxShadow: scanning ? '0 0 20px rgba(245,158,11,0.3)' : 'none',
              transition: 'all 0.3s',
            }}
          />
        </div>
      )}

      {/* Photo mode */}
      {mode === 'Photo' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-8"
          style={{ background: '#0a0e1a' }}
        >
          <div className="text-6xl mb-6">🖼️</div>
          <p className="text-text-secondary text-sm mb-6 text-center">
            Take or select a photo of a Magic card to identify it
          </p>
          <label
            className="w-full max-w-xs flex items-center justify-center gap-3 rounded-xl py-4 px-6 font-semibold cursor-pointer"
            style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
          >
            {scanning ? 'Identifying…' : '📷 Select Photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoUpload}
              disabled={scanning}
              className="hidden"
            />
          </label>
        </div>
      )}

      {/* Search mode */}
      {mode === 'Search' && (
        <div className="absolute inset-0 p-4 pt-20" style={{ background: '#0a0e1a' }}>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search card name…"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
              style={{
                background: '#1a2235',
                border: '1px solid #1e2d47',
                color: '#f1f5f9',
                minHeight: 44,
              }}
              autoFocus
            />
            {searchLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div
              className="mt-2 rounded-xl overflow-hidden"
              style={{ background: '#111827', border: '1px solid #1e2d47' }}
            >
              {suggestions.map((name, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectSearchCard(name)}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-bg-elevated transition-colors"
                  style={{
                    color: '#f1f5f9',
                    borderBottom: i < suggestions.length - 1 ? '1px solid #1e2d47' : 'none',
                    minHeight: 44,
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top overlay: Deck selector + mode toggle */}
      <div
        className="absolute top-0 left-0 right-0 px-4 pt-4 pb-2"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)' }}
      >
        {/* Deck selector */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowDeckPicker(!showDeckPicker)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 36 }}
          >
            <span>📦</span>
            <span className="max-w-32 truncate">{activeDeck?.name || 'No deck'}</span>
            <span style={{ color: '#94a3b8' }}>▾</span>
          </button>

          {/* Scan count badge */}
          {tier === 'free' && (
            <div
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: scanCount >= 80 ? 'rgba(239,68,68,0.9)' : 'rgba(17,24,39,0.85)',
                color: '#f1f5f9',
                border: '1px solid #1e2d47',
              }}
            >
              {scanCount}/{scanLimit}
            </div>
          )}
        </div>

        {/* Deck picker dropdown */}
        {showDeckPicker && (
          <div
            className="rounded-xl overflow-hidden mb-2"
            style={{ background: '#111827', border: '1px solid #1e2d47' }}
          >
            {decks.length === 0 && (
              <div className="px-4 py-3 text-sm text-text-secondary">No decks yet — create one in My Decks</div>
            )}
            {decks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => { setActiveDeckId(deck.id); setShowDeckPicker(false); }}
                className="w-full text-left px-4 py-3 text-sm flex items-center gap-2"
                style={{
                  color: deck.id === activeDeckId ? '#f59e0b' : '#f1f5f9',
                  borderBottom: '1px solid #1e2d47',
                  minHeight: 44,
                  background: deck.id === activeDeckId ? 'rgba(245,158,11,0.1)' : 'transparent',
                }}
              >
                {deck.id === activeDeckId && '✓ '}
                {deck.name}
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

        {/* Mode toggle */}
        <div
          className="flex rounded-xl p-1"
          style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid #1e2d47' }}
        >
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setResult(null); }}
              className="flex-1 py-2 text-xs font-semibold rounded-lg transition-all"
              style={{
                background: mode === m ? '#f59e0b' : 'transparent',
                color: mode === m ? '#0a0e1a' : '#94a3b8',
                minHeight: 36,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Scanning indicator */}
      {scanning && mode === 'Live Scan' && (
        <div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-4 py-2 text-sm"
          style={{ background: 'rgba(245,158,11,0.9)', color: '#0a0e1a', fontWeight: 600 }}
        >
          <div className="w-3 h-3 border-2 border-bg-primary border-t-transparent rounded-full animate-spin" />
          Identifying…
        </div>
      )}

      {/* Scan limit warning */}
      {tier === 'free' && scanCount >= scanLimit && (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/70">
          <div
            className="rounded-2xl p-6 text-center max-w-xs"
            style={{ background: '#111827', border: '1px solid #1e2d47' }}
          >
            <div className="text-4xl mb-3">🚫</div>
            <h3 className="font-bold text-text-primary mb-2">Monthly limit reached</h3>
            <p className="text-text-secondary text-sm mb-4">
              You've used all 100 free scans this month. Upgrade to Pro for unlimited scanning.
            </p>
            <button
              onClick={() => window.location.href = '/profile'}
              className="w-full rounded-xl py-3 font-semibold text-sm"
              style={{ background: '#f59e0b', color: '#0a0e1a' }}
            >
              Upgrade to Pro
            </button>
          </div>
        </div>
      )}

      {/* Card result bottom sheet */}
      {result && (
        <CardResultSheet
          card={result}
          decks={decks}
          activeDeckId={activeDeckId}
          onAdd={addCardToDeck}
          onDismiss={() => setResult(null)}
        />
      )}
    </div>
  );
}
