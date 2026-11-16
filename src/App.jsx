import React, { useState, useMemo, useEffect, useCallback } from 'react';
import './App.css';
import {
  TournamentStackModel,
  DEICMCalculator,
  DEICMBubbleFactorCalculator,
} from './tournament_deicm.js';

// Predefined tournament presets for quick testing
const PRESETS = {
  pythonDemo: {
    name: '初期値 (サテライト)',
    totalEntries: 279,
    remainingPlayers: 9,
    startStack: 5000,
    rebuys: 0,
    rebuyStack: 0,
    addons: 0,
    addonStack: 0,
    leaderStack: 476329,
    heroStack: 120062,
    bbSize: 15000,
    prizes: [5000, 5000, 5000],
  },
  mttFinalTable: {
    name: 'MTT ファイナルテーブル (9人)',
    totalEntries: 100,
    remainingPlayers: 9,
    startStack: 20000,
    rebuys: 0,
    rebuyStack: 0,
    addons: 0,
    addonStack: 0,
    leaderStack: 550000,
    heroStack: 210000,
    bbSize: 20000,
    prizes: [6000, 4000, 2800, 2000, 1500, 1200, 1000, 800, 700],
  },
  bubblePressure: {
    name: 'バブル直前 (入賞15位 / 残り16人)',
    totalEntries: 150,
    remainingPlayers: 16,
    startStack: 10000,
    rebuys: 20,
    rebuyStack: 10000,
    addons: 10,
    addonStack: 15000,
    leaderStack: 320000,
    heroStack: 95000,
    bbSize: 8000,
    prizes: [4500, 3000, 2000, 1500, 1200, 1000, 850, 750, 650, 550, 480, 420, 380, 360, 360],
  },
};

export default function App() {
  // Sidebar state (出し入れ可能 / モバイル時は初期で閉じる)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth > 900;
    }
    return true;
  });

  // Input State
  const [params, setParams] = useState(PRESETS.pythonDemo);
  const [activePreset, setActivePreset] = useState('pythonDemo');
  const [showRebuys, setShowRebuys] = useState(false);
  const [prizeType, setPrizeType] = useState('satellite'); // 'satellite', 'custom'
  const [satellitePrizeCount, setSatellitePrizeCount] = useState(3);
  const [satellitePrizeAmount, setSatellitePrizeAmount] = useState(5000);

  // Status flags
  const [isDirty, setIsDirty] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isBfCalculating, setIsBfCalculating] = useState(false);

  // Sorting state for table
  const [sortField, setSortField] = useState('stack');
  const [sortDirection, setSortDirection] = useState('desc');

  // Stored Calculation Result
  const [computationResult, setComputationResult] = useState({ success: false, loading: true });

  // Selected Matchup Players (P1: 基準, P2: 相手) & BF Result
  const [selectedP1Idx, setSelectedP1Idx] = useState(null);
  const [selectedP2Idx, setSelectedP2Idx] = useState(null);
  const [activeBfResult, setActiveBfResult] = useState(null);
  const [bfCache, setBfCache] = useState({});
  // BF詳細内訳（基準エクイティやスタック変化などの6項目）の表示/非表示トグル
  const [showBfDetails, setShowBfDetails] = useState(false);

  // Resolve prizes array
  const resolvePrizes = useCallback((type, count, amount, customList) => {
    if (type === 'satellite') {
      const c = Math.max(1, Number(count) || 1);
      const amt = Number(amount) || 0;
      return Array(c).fill(amt);
    }
    return customList && customList.length > 0 ? customList : [1000];
  }, []);

  // ICM Calculation (Fast baseline only)
  const runCalculation = useCallback((currentParams, prizesList) => {
    setIsCalculating(true);

    try {
      if (
        !currentParams.totalEntries ||
        !currentParams.remainingPlayers ||
        !currentParams.startStack ||
        !currentParams.bbSize
      ) {
        setComputationResult({
          error: '必須パラメータを入力してください。',
        });
        setIsCalculating(false);
        return;
      }

      if (currentParams.remainingPlayers < 2) {
        setComputationResult({ error: '残り人数は2人以上必要です。' });
        setIsCalculating(false);
        return;
      }

      if (currentParams.remainingPlayers > currentParams.totalEntries) {
        setComputationResult({ error: '残り人数が総エントリー数を超えています。' });
        setIsCalculating(false);
        return;
      }

      const model = new TournamentStackModel({
        totalEntries: currentParams.totalEntries,
        remainingPlayers: currentParams.remainingPlayers,
        startStack: currentParams.startStack,
        rebuys: currentParams.rebuys || 0,
        rebuyStack: currentParams.rebuyStack || 0,
        addons: currentParams.addons || 0,
        addonStack: currentParams.addonStack || 0,
        leaderStack: currentParams.leaderStack,
        heroStack: currentParams.heroStack,
        bbSize: currentParams.bbSize,
      });

      const summary = model.getSummary();
      const validPrizes = prizesList && prizesList.length > 0 ? prizesList : [1000];

      const { stacks, Q, equities } = DEICMCalculator.calculateFromModel(
        model,
        validPrizes
      );

      const totalChips = stacks.reduce((sum, s) => sum + s, 0);
      const totalPrize = equities.reduce((sum, e) => sum + e, 0);

      const heroIdx = model.heroIdx;
      const leaderIdx = stacks.length - 1;

      const players = [];
      for (let i = 0; i < stacks.length; i++) {
        const isHero = i === heroIdx;
        const isCL = i === leaderIdx;
        const role = isHero ? 'Hero' : isCL ? 'CL' : 'Villain';
        const s = stacks[i];
        const eq = equities[i];
        const chipPct = totalChips > 0 ? (s / totalChips) * 100 : 0;
        const eqPct = totalPrize > 0 ? (eq / totalPrize) * 100 : 0;

        players.push({
          idx: i,
          id: `PLAYER${i + 1}`,
          role,
          isHero,
          isCL,
          stack: s,
          stackBB: s / currentParams.bbSize,
          chipPct,
          equity: eq,
          equityPct: eqPct,
        });
      }

      setComputationResult({
        success: true,
        model,
        summary,
        stacks,
        equities,
        totalChips,
        totalPrize,
        heroIdx,
        leaderIdx,
        players,
        validPrizes,
        bbSize: currentParams.bbSize,
      });

      const initialP1 = heroIdx;
      const initialP2 = leaderIdx !== heroIdx ? leaderIdx : (heroIdx === 0 ? 1 : 0);
      setSelectedP1Idx(initialP1);
      setSelectedP2Idx(initialP2);

      // 初期対戦 (Hero vs CL) のBFを即時計算
      try {
        const initBf = DEICMBubbleFactorCalculator.calculateMatchupBf({
          stacks,
          prizes: validPrizes,
          p1Idx: initialP1,
          p2Idx: initialP2,
          baseEquities: equities,
        });
        const key = `${initialP1}_${initialP2}`;
        const revKey = `${initialP2}_${initialP1}`;
        setActiveBfResult(initBf);
        setBfCache({
          [key]: initBf,
          [revKey]: {
            p1Idx: initialP2,
            p2Idx: initialP1,
            effectiveStack: initBf.effectiveStack,
            p1: initBf.p2,
            p2: initBf.p1,
          },
        });
      } catch {
        setActiveBfResult(null);
        setBfCache({});
      }

      setIsDirty(false);
    } catch (err) {
      setComputationResult({ error: err.message });
    } finally {
      setIsCalculating(false);
    }
  }, []);

  // 2者間のBF計算・更新ハンドラ
  const handleSelectMatchup = useCallback(
    (newP1Idx, newP2Idx) => {
      if (!computationResult.success) return;
      if (newP1Idx === null || newP2Idx === null || newP1Idx === newP2Idx) return;

      setSelectedP1Idx(newP1Idx);
      setSelectedP2Idx(newP2Idx);

      const cacheKey = `${newP1Idx}_${newP2Idx}`;
      if (bfCache[cacheKey]) {
        setActiveBfResult(bfCache[cacheKey]);
        return;
      }

      setIsBfCalculating(true);
      setTimeout(() => {
        try {
          const { stacks, validPrizes, equities } = computationResult;
          const res = DEICMBubbleFactorCalculator.calculateMatchupBf({
            stacks,
            prizes: validPrizes,
            p1Idx: newP1Idx,
            p2Idx: newP2Idx,
            baseEquities: equities,
          });

          const reverseKey = `${newP2Idx}_${newP1Idx}`;
          const reverseRes = {
            p1Idx: newP2Idx,
            p2Idx: newP1Idx,
            effectiveStack: res.effectiveStack,
            p1: res.p2,
            p2: res.p1,
          };

          setActiveBfResult(res);
          setBfCache((prev) => ({
            ...prev,
            [cacheKey]: res,
            [reverseKey]: reverseRes,
          }));
        } finally {
          setIsBfCalculating(false);
        }
      }, 10);
    },
    [computationResult, bfCache]
  );

  // プレイヤー1 (基準) の変更
  const handleSelectP1 = useCallback(
    (newP1Idx) => {
      if (!computationResult.success) return;
      let targetP2 = selectedP2Idx;
      if (targetP2 === null || targetP2 === newP1Idx) {
        targetP2 = newP1Idx === 0 ? 1 : 0;
      }
      handleSelectMatchup(newP1Idx, targetP2);
    },
    [computationResult.success, selectedP2Idx, handleSelectMatchup]
  );

  // プレイヤー2 (相手) の変更
  const handleSelectP2 = useCallback(
    (newP2Idx) => {
      if (!computationResult.success) return;
      handleSelectMatchup(selectedP1Idx, newP2Idx);
    },
    [computationResult.success, selectedP1Idx, handleSelectMatchup]
  );

  // プレイヤー1とプレイヤー2の入れ替え (⇄)
  const handleSwapPlayers = useCallback(() => {
    if (selectedP1Idx !== null && selectedP2Idx !== null) {
      handleSelectMatchup(selectedP2Idx, selectedP1Idx);
    }
  }, [selectedP1Idx, selectedP2Idx, handleSelectMatchup]);

  // 現在のP1に対する全プレイヤーのBFを一括計算
  const handleCalculateAllBfForP1 = useCallback(() => {
    if (!computationResult.success || selectedP1Idx === null) return;
    setIsBfCalculating(true);
    setTimeout(() => {
      try {
        const { stacks, validPrizes, equities, players } = computationResult;
        const newCache = { ...bfCache };
        players.forEach((p) => {
          if (p.idx !== selectedP1Idx) {
            const key = `${selectedP1Idx}_${p.idx}`;
            if (!newCache[key]) {
              const res = DEICMBubbleFactorCalculator.calculateMatchupBf({
                stacks,
                prizes: validPrizes,
                p1Idx: selectedP1Idx,
                p2Idx: p.idx,
                baseEquities: equities,
              });
              const revKey = `${p.idx}_${selectedP1Idx}`;
              newCache[key] = res;
              newCache[revKey] = {
                p1Idx: p.idx,
                p2Idx: selectedP1Idx,
                effectiveStack: res.effectiveStack,
                p1: res.p2,
                p2: res.p1,
              };
            }
          }
        });
        setBfCache(newCache);
        if (selectedP2Idx !== null && newCache[`${selectedP1Idx}_${selectedP2Idx}`]) {
          setActiveBfResult(newCache[`${selectedP1Idx}_${selectedP2Idx}`]);
        }
      } finally {
        setIsBfCalculating(false);
      }
    }, 10);
  }, [computationResult, selectedP1Idx, selectedP2Idx, bfCache]);

  // Initial Calculation
  useEffect(() => {
    const initPrizes = resolvePrizes('satellite', 3, 5000, PRESETS.pythonDemo.prizes);
    runCalculation(PRESETS.pythonDemo, initPrizes);
  }, [resolvePrizes, runCalculation]);

  // Handle Input Changes
  const handleInputChange = (field, value) => {
    setActivePreset(null);
    setIsDirty(true);
    setParams((prev) => ({
      ...prev,
      [field]: value === '' ? '' : Number(value),
    }));
  };

  // Handle Preset Load
  const loadPreset = (presetKey) => {
    setActivePreset(presetKey);
    const p = PRESETS[presetKey];
    setParams(p);

    let pType = 'custom';
    let sCount = satellitePrizeCount;
    let sAmt = satellitePrizeAmount;

    if (presetKey === 'pythonDemo') {
      pType = 'satellite';
      sCount = 3;
      sAmt = 5000;
      setPrizeType('satellite');
      setSatellitePrizeCount(3);
      setSatellitePrizeAmount(5000);
    } else {
      setPrizeType('custom');
    }

    const prizesToUse = resolvePrizes(pType, sCount, sAmt, p.prizes);
    runCalculation(p, prizesToUse);
  };

  // Calculate Button
  const handleCalculateClick = () => {
    const prizes = resolvePrizes(prizeType, satellitePrizeCount, satellitePrizeAmount, params.prizes);
    runCalculation(params, prizes);
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      setIsSidebarOpen(false);
    }
  };

  // Prize manipulation
  const updatePrize = (index, value) => {
    setIsDirty(true);
    const newPrizes = [...params.prizes];
    newPrizes[index] = Number(value) || 0;
    setParams((prev) => ({ ...prev, prizes: newPrizes }));
  };

  const addPrize = () => {
    setIsDirty(true);
    const lastPrize = params.prizes[params.prizes.length - 1] || 1000;
    setParams((prev) => ({
      ...prev,
      prizes: [...prev.prizes, Math.max(100, Math.round(lastPrize * 0.8))],
    }));
  };

  const removePrize = (index) => {
    if (params.prizes.length <= 1) return;
    setIsDirty(true);
    const newPrizes = params.prizes.filter((_, i) => i !== index);
    setParams((prev) => ({ ...prev, prizes: newPrizes }));
  };

  // Sorted players for table
  const sortedPlayers = useMemo(() => {
    if (!computationResult.players) return [];
    const list = [...computationResult.players];
    list.sort((a, b) => {
      let comp = 0;
      if (sortField === 'stack') comp = a.stack - b.stack;
      else if (sortField === 'equity') comp = a.equity - b.equity;
      else if (sortField === 'id') comp = a.idx - b.idx;
      else if (sortField === 'bf') {
        const getBf = (idx) => {
          if (idx === selectedP1Idx) return -9999;
          const key = `${selectedP1Idx}_${idx}`;
          return bfCache[key] ? bfCache[key].p1.bubbleFactor : 0;
        };
        comp = getBf(a.idx) - getBf(b.idx);
      }
      return sortDirection === 'desc' ? -comp : comp;
    });
    return list;
  }, [computationResult.players, sortField, sortDirection, bfCache, selectedP1Idx]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // CSV Export handler
  const handleExportCSV = () => {
    if (!computationResult.success) return;
    const { players } = computationResult;
    const p1Player = players[selectedP1Idx] || players[0];
    const headers = [
      'Player_ID',
      'Role',
      'Stack',
      'Stack_BB',
      'ICM_Equity_Dollar',
      `Bubble_Factor_vs_${p1Player.id}`,
    ];

    const rows = players.map((p) => {
      const key = `${selectedP1Idx}_${p.idx}`;
      const bfVal =
        p.idx === selectedP1Idx
          ? 'Base (Self)'
          : bfCache[key]
          ? bfCache[key].p1.bubbleFactor
          : '-';
      return [
        p.id,
        p.role,
        Math.round(p.stack),
        p.stackBB.toFixed(1),
        p.equity.toFixed(2),
        bfVal,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `tournament_deicm_results_vs_${p1Player.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Resolve current players for UI
  const p1Player = computationResult.players?.[selectedP1Idx];
  const p2Player = computationResult.players?.[selectedP2Idx];

  return (
    <div className="app-viewport">
      {/* Slim Header */}
      <header className="app-header-slim">
        <div className="header-brand">
          <span className="brand-badge">DE-ICM</span>
          <h1 className="app-title-slim">
            <span className="title-full">Tournament ICM & Bubble Factor Analyzer</span>
            <span className="title-short">Tournament ICM</span>
          </h1>
        </div>

        <div className="header-right">
          {/* デスクトップ用プリセットボタングループ */}
          <div className="preset-group-slim desktop-only">
            <span className="preset-label-slim">プリセット:</span>
            {Object.keys(PRESETS).map((key) => (
              <button
                key={key}
                type="button"
                className={`btn-preset-slim ${activePreset === key ? 'active' : ''}`}
                onClick={() => loadPreset(key)}
              >
                {PRESETS[key].name}
              </button>
            ))}
          </div>

          {/* モバイル用プリセットセレクト */}
          <div className="preset-select-wrap mobile-only">
            <select
              className="preset-select-mobile"
              value={activePreset}
              onChange={(e) => loadPreset(e.target.value)}
              aria-label="プリセット選択"
            >
              {Object.keys(PRESETS).map((key) => (
                <option key={key} value={key}>
                  {PRESETS[key].name}
                </option>
              ))}
            </select>
          </div>

          {/* モバイル用設定トグルボタン */}
          <button
            type="button"
            className={`btn-mobile-config mobile-only ${isDirty ? 'has-changes' : ''} ${isSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label="設定パネルを開閉"
          >
            <span className="btn-mobile-config-icon">{isSidebarOpen ? '✕' :""}</span>
            <span className="btn-mobile-config-text">{isSidebarOpen ? '閉じる' : '設定'}</span>
            {isDirty && !isSidebarOpen && <span className="drawer-badge-dot" />}
          </button>
        </div>
      </header>

      {/* Main Workspace (Fits Window Size) */}
      <div className="app-workspace">
        {/* モバイル用背景オーバーレイ */}
        {isSidebarOpen && (
          <div
            className="sidebar-backdrop mobile-only"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 引き出しタブボタン (PC専用：画面中央左に配置) */}
        <button
          type="button"
          className={`drawer-handle-tab desktop-only ${isDirty ? 'has-changes' : ''}`}
          style={{ left: isSidebarOpen ? '342px' : '0px' }}
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          title={isSidebarOpen ? '設定パネルを収納する (クリック)' : '設定パネルを引き出す (クリック)'}
        >
          <span className="drawer-tab-arrow">{isSidebarOpen ? '◀' : '▶'}</span>
          <span className="drawer-tab-text">{isSidebarOpen ? 'CLOSE' : 'CONFIG'}</span>
          {isDirty && (
            <span
              className="drawer-badge-dot"
              title="未計算の変更があります"
            />
          )}
        </button>

        {/* Left Column: Collapsible Sidebar */}
        <aside className={`sidebar-panel ${isSidebarOpen ? '' : 'closed'}`}>
          <div className="sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>トーナメント設定</span>
            </div>
            <button
              type="button"
              className="btn-close-sidebar"
              onClick={() => setIsSidebarOpen(false)}
              title="設定パネルを閉じる"
            >
              ◀ 閉じる
            </button>
          </div>

          <div className="sidebar-content">
            {computationResult.error && (
              <div className="error-banner">[エラー] {computationResult.error}</div>
            )}

            {/* Core Parameters */}
            <div className="form-section-compact">
              <div className="section-label-compact">基本パラメータ</div>
              <div className="grid-2col-compact">
                <div className="form-group-compact">
                  <label className="form-label-compact">
                    エントリー総数 <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    min="2"
                    className="form-input-compact"
                    value={params.totalEntries}
                    onChange={(e) => handleInputChange('totalEntries', e.target.value)}
                  />
                </div>

                <div className="form-group-compact">
                  <label className="form-label-compact">
                    残り人数 <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    min="2"
                    className="form-input-compact"
                    value={params.remainingPlayers}
                    onChange={(e) =>
                      handleInputChange('remainingPlayers', e.target.value)
                    }
                  />
                </div>
              </div>

              <div className="grid-2col-compact">
                <div className="form-group-compact">
                  <label className="form-label-compact">
                    初期スタック <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="form-input-compact"
                    value={params.startStack}
                    onChange={(e) => handleInputChange('startStack', e.target.value)}
                  />
                </div>

                <div className="form-group-compact">
                  <label className="form-label-compact">
                    BB <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="form-input-compact"
                    value={params.bbSize}
                    onChange={(e) => handleInputChange('bbSize', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Key Players */}
            <div className="form-section-compact">
              <div className="section-label-compact">スタック設定 (CL / Hero)</div>
              <div className="form-group-compact">
                <label className="form-label-compact">
                  <span>チップリーダースタック <span className="req">*</span></span>
                  {params.bbSize > 0 && params.leaderStack && (
                    <small>
                      {(Number(params.leaderStack) / params.bbSize).toFixed(1)} BB
                    </small>
                  )}
                </label>
                <input
                  type="number"
                  className="form-input-compact"
                  value={params.leaderStack}
                  onChange={(e) => handleInputChange('leaderStack', e.target.value)}
                />
              </div>

              <div className="form-group-compact">
                <label className="form-label-compact">
                  <span>Heroスタック <span className="req">*</span></span>
                  {params.bbSize > 0 && params.heroStack && (
                    <small>
                      {(Number(params.heroStack) / params.bbSize).toFixed(1)} BB
                    </small>
                  )}
                </label>
                <input
                  type="number"
                  className="form-input-compact"
                  value={params.heroStack}
                  onChange={(e) => handleInputChange('heroStack', e.target.value)}
                />
              </div>
            </div>

            {/* Rebuys / Addons */}
            <div className="form-section-compact">
              <div
                className="accordion-header-compact"
                onClick={() => setShowRebuys(!showRebuys)}
              >
                <span>{showRebuys ? '▼' : '▶'} リバイ・アドオン設定</span>
                <small style={{ color: 'var(--text-dim)' }}>
                  {params.rebuys > 0 || params.addons > 0 ? 'あり' : 'なし(0)'}
                </small>
              </div>

              {showRebuys && (
                <div style={{ marginTop: '6px' }}>
                  <div className="grid-2col-compact">
                    <div className="form-group-compact">
                      <label className="form-label-compact">リバイ回数</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input-compact"
                        value={params.rebuys}
                        onChange={(e) => handleInputChange('rebuys', e.target.value)}
                      />
                    </div>
                    <div className="form-group-compact">
                      <label className="form-label-compact">リバイスタック</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input-compact"
                        value={params.rebuyStack}
                        onChange={(e) =>
                          handleInputChange('rebuyStack', e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="grid-2col-compact">
                    <div className="form-group-compact">
                      <label className="form-label-compact">アドオン回数</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input-compact"
                        value={params.addons}
                        onChange={(e) => handleInputChange('addons', e.target.value)}
                      />
                    </div>
                    <div className="form-group-compact">
                      <label className="form-label-compact">アドオンスタック</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input-compact"
                        value={params.addonStack}
                        onChange={(e) =>
                          handleInputChange('addonStack', e.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Prizes */}
            <div className="form-section-compact">
              <div className="section-label-compact">賞金ストラクチャー</div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                <button
                  type="button"
                  className={`btn-sm-compact ${prizeType === 'satellite' ? 'active' : ''}`}
                  style={{
                    background:
                      prizeType === 'satellite'
                        ? 'var(--accent-blue)'
                        : 'var(--bg-secondary)',
                    color: prizeType === 'satellite' ? '#fff' : 'var(--text-muted)',
                  }}
                  onClick={() => {
                    setPrizeType('satellite');
                    setIsDirty(true);
                  }}
                >
                  サテライト型
                </button>
                <button
                  type="button"
                  className={`btn-sm-compact ${prizeType === 'custom' ? 'active' : ''}`}
                  style={{
                    background:
                      prizeType === 'custom'
                        ? 'var(--accent-blue)'
                        : 'var(--bg-secondary)',
                    color: prizeType === 'custom' ? '#fff' : 'var(--text-muted)',
                  }}
                  onClick={() => {
                    setPrizeType('custom');
                    setIsDirty(true);
                  }}
                >
                  カスタム配分
                </button>
              </div>

              {prizeType === 'satellite' ? (
                <div className="grid-2col-compact">
                  <div className="form-group-compact">
                    <label className="form-label-compact">枠数</label>
                    <input
                      type="number"
                      min="1"
                      className="form-input-compact"
                      value={satellitePrizeCount}
                      onChange={(e) => {
                        setSatellitePrizeCount(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>
                  <div className="form-group-compact">
                    <label className="form-label-compact">賞金 ($)</label>
                    <input
                      type="number"
                      min="1"
                      className="form-input-compact"
                      value={satellitePrizeAmount}
                      onChange={(e) => {
                        setSatellitePrizeAmount(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <div className="prize-list-slim">
                    {params.prizes.map((p, idx) => (
                      <div key={idx} className="prize-item-compact">
                        <span className="prize-rank-compact">#{idx + 1}</span>
                        <input
                          type="number"
                          className="form-input-compact"
                          style={{ flex: 1 }}
                          value={p}
                          onChange={(e) => updatePrize(idx, e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-remove-prize-compact"
                          onClick={() => removePrize(idx)}
                          title="削除"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-sm-compact"
                    style={{ width: '100%', marginTop: '4px' }}
                    onClick={addPrize}
                  >
                    + 順位を追加
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Footer with Calculate Button */}
          <div className="sidebar-footer">
            <button
              type="button"
              className={`btn-calculate ${isDirty ? 'has-changes' : ''}`}
              onClick={handleCalculateClick}
              disabled={isCalculating}
            >
              {isCalculating ? (
                <>計算中...</>
              ) : isDirty ? (
                <>設定を反映して計算</>
              ) : (
                <>ICMを計算する</>
              )}
            </button>
            {isDirty && (
              <div className="calc-hint">
                ※ 入力変更あり。ボタンを押して更新
              </div>
            )}
          </div>
        </aside>

        {/* Right Dashboard Area (Fills Viewport) */}
        <main className="dashboard-main">
          {computationResult.success && (
            <>
              {/* 2-Player Matchup Bubble Factor Panel */}
              <div className="bf-panel-compact">
                <div className="bf-header-compact">
                  <div className="bf-title-compact">
                    <span>バブルファクター分析 (2者間対決)</span>
                    <div className="avg-stack-badge">
                      <span className="avg-badge-label">AVG</span>
                      <span className="avg-badge-val">
                        {Math.round(computationResult.summary.avgStack).toLocaleString()}
                      </span>
                      <span className="avg-badge-bb">
                        ({(computationResult.summary.avgStack / computationResult.bbSize).toFixed(1)} BB)
                      </span>
                    </div>
                  </div>

                  {/* Matchup Selection Controls */}
                  <div className="matchup-controls-wrap">
                    <div className="matchup-selector-item">
                      <label className="matchup-label">プレイヤー1 (基準):</label>
                      <select
                        className="player-select"
                        value={selectedP1Idx !== null ? selectedP1Idx : ''}
                        onChange={(e) => handleSelectP1(Number(e.target.value))}
                        aria-label="プレイヤー1 (基準) 選択"
                      >
                        {computationResult.players.map((p) => (
                          <option key={p.idx} value={p.idx}>
                            {p.id} {p.isHero ? '(Hero)' : p.isCL ? '(CL)' : ''} - {Math.round(p.stack).toLocaleString()} ({p.stackBB.toFixed(1)} BB)
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      className="btn-swap-players"
                      onClick={handleSwapPlayers}
                      title="プレイヤー1とプレイヤー2を入れ替え (⇄)"
                      aria-label="プレイヤーを入れ替え"
                    >
                      <span className="swap-icon">⇄</span>
                      <span className="swap-text">入替</span>
                    </button>

                    <div className="matchup-selector-item">
                      <label className="matchup-label">プレイヤー2 (相手):</label>
                      <select
                        className="player-select"
                        value={selectedP2Idx !== null ? selectedP2Idx : ''}
                        onChange={(e) => handleSelectP2(Number(e.target.value))}
                        aria-label="プレイヤー2 (相手) 選択"
                      >
                        <option value="" disabled>-- 相手を選択 --</option>
                        {computationResult.players
                          .filter((p) => p.idx !== selectedP1Idx)
                          .map((p) => (
                            <option key={p.idx} value={p.idx}>
                              {p.id} {p.isHero ? '(Hero)' : p.isCL ? '(CL)' : ''} - {Math.round(p.stack).toLocaleString()} ({p.stackBB.toFixed(1)} BB)
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                </div>

                {isBfCalculating ? (
                  <div className="bf-loading">
                    <span>2者間のバブルファクターを計算中...</span>
                  </div>
                ) : activeBfResult && p1Player && p2Player ? (
                  <div className="matchup-display-area">
                    {/* Matchup Header Info */}
                    <div className="matchup-info-strip">
                      <div className="matchup-info-left">
                        <div className="matchup-vs-badge">
                          <span className="vs-player p1-tag">{p1Player.id}</span>
                          <span className="vs-divider">VS</span>
                          <span className="vs-player p2-tag">{p2Player.id}</span>
                        </div>
                        <div className="matchup-eff-info">
                          <span>有効スタック: </span>
                          <strong>{Math.round(activeBfResult.effectiveStack).toLocaleString()}</strong>
                          <span className="eff-bb"> ({(activeBfResult.effectiveStack / computationResult.bbSize).toFixed(1)} BB)</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn-toggle-bf-details"
                        onClick={() => setShowBfDetails((prev) => !prev)}
                        title="基準エクイティやスタック変化などの詳細6項目の表示/非表示を切り替え"
                      >
                        {showBfDetails ? '内訳を折りたたむ ▲' : '詳細内訳を表示 (6項目) ▼'}
                      </button>
                    </div>

                    {/* Side-by-Side Dual BF Cards */}
                    <div className="matchup-cards-grid">
                      {/* Card 1: Player 1 Perspective */}
                      <div className="player-bf-card p1-perspective">
                        <div className="card-top-row">
                          <div className="card-player-id">
                            <span className="player-name-bold">{p1Player.id} 視点</span>
                            {p1Player.isHero && <span className="badge badge-hero">Hero</span>}
                            {p1Player.isCL && <span className="badge badge-cl">CL</span>}
                          </div>
                          <span
                            className={`badge ${
                              activeBfResult.p1.coverStatus.includes('Covered')
                                ? 'badge-covered'
                                : activeBfResult.p1.coverStatus.includes('Covering')
                                ? 'badge-covering'
                                : 'badge-equal'
                            }`}
                          >
                            {activeBfResult.p1.coverStatus}
                          </span>
                        </div>

                        <div className="card-score-box">
                          <div className="score-primary">
                            <span className="score-label">Bubble Factor</span>
                            <span className="score-number">{activeBfResult.p1.bubbleFactor.toFixed(3)}</span>
                          </div>
                          <div className="score-winrate">
                            <span className="winrate-label">必要勝率</span>
                            <span className="winrate-val">{activeBfResult.p1.minWinRateRequired}</span>
                          </div>
                        </div>

                        {showBfDetails && (
                          <div className="card-metrics-grid">
                            <div className="metric-cell">
                              <span className="m-label">基準エクイティ</span>
                              <span className="m-val">${activeBfResult.p1.eqBase.toFixed(2)}</span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">勝利時エクイティ</span>
                              <span className="m-val gain-text">
                                ${activeBfResult.p1.eqWin.toFixed(2)}{' '}
                                <small>(+${activeBfResult.p1.gain.toFixed(2)})</small>
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">敗北時エクイティ</span>
                              <span className="m-val risk-text">
                                ${activeBfResult.p1.eqLoss.toFixed(2)}{' '}
                                <small>(-${activeBfResult.p1.risk.toFixed(2)})</small>
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">現在スタック</span>
                              <span className="m-val">
                                {Math.round(p1Player.stack).toLocaleString()} ({p1Player.stackBB.toFixed(1)} BB)
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">勝利時スタック</span>
                              <span className="m-val gain-text">
                                {Math.round(activeBfResult.p1.winStack).toLocaleString()} (
                                {(activeBfResult.p1.winStack / computationResult.bbSize).toFixed(1)} BB)
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">敗北時スタック</span>
                              <span className="m-val risk-text">
                                {Math.round(activeBfResult.p1.lossStack).toLocaleString()} (
                                {(activeBfResult.p1.lossStack / computationResult.bbSize).toFixed(1)} BB)
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Card 2: Player 2 Perspective */}
                      <div className="player-bf-card p2-perspective">
                        <div className="card-top-row">
                          <div className="card-player-id">
                            <span className="player-name-bold">{p2Player.id} 視点</span>
                            {p2Player.isHero && <span className="badge badge-hero">Hero</span>}
                            {p2Player.isCL && <span className="badge badge-cl">CL</span>}
                          </div>
                          <span
                            className={`badge ${
                              activeBfResult.p2.coverStatus.includes('Covered')
                                ? 'badge-covered'
                                : activeBfResult.p2.coverStatus.includes('Covering')
                                ? 'badge-covering'
                                : 'badge-equal'
                            }`}
                          >
                            {activeBfResult.p2.coverStatus}
                          </span>
                        </div>

                        <div className="card-score-box">
                          <div className="score-primary">
                            <span className="score-label">Bubble Factor</span>
                            <span className="score-number">{activeBfResult.p2.bubbleFactor.toFixed(3)}</span>
                          </div>
                          <div className="score-winrate">
                            <span className="winrate-label">必要勝率</span>
                            <span className="winrate-val">{activeBfResult.p2.minWinRateRequired}</span>
                          </div>
                        </div>

                        {showBfDetails && (
                          <div className="card-metrics-grid">
                            <div className="metric-cell">
                              <span className="m-label">基準エクイティ</span>
                              <span className="m-val">${activeBfResult.p2.eqBase.toFixed(2)}</span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">勝利時エクイティ</span>
                              <span className="m-val gain-text">
                                ${activeBfResult.p2.eqWin.toFixed(2)}{' '}
                                <small>(+${activeBfResult.p2.gain.toFixed(2)})</small>
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">敗北時エクイティ</span>
                              <span className="m-val risk-text">
                                ${activeBfResult.p2.eqLoss.toFixed(2)}{' '}
                                <small>(-${activeBfResult.p2.risk.toFixed(2)})</small>
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">現在スタック</span>
                              <span className="m-val">
                                {Math.round(p2Player.stack).toLocaleString()} ({p2Player.stackBB.toFixed(1)} BB)
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">勝利時スタック</span>
                              <span className="m-val gain-text">
                                {Math.round(activeBfResult.p2.winStack).toLocaleString()} (
                                {(activeBfResult.p2.winStack / computationResult.bbSize).toFixed(1)} BB)
                              </span>
                            </div>
                            <div className="metric-cell">
                              <span className="m-label">敗北時スタック</span>
                              <span className="m-val risk-text">
                                {Math.round(activeBfResult.p2.lossStack).toLocaleString()} (
                                {(activeBfResult.p2.lossStack / computationResult.bbSize).toFixed(1)} BB)
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bf-placeholder">
                    上部のセレクターまたは下記の表からプレイヤーを選択すると、2者間のバブルファクターと必要勝率を瞬時に算出・対比します。
                  </div>
                )}
              </div>

              {/* ICM Table Card (Fills remaining height with sticky header) */}
              <div className="table-card-fill">
                <div className="table-toolbar-slim">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>全プレイヤー ICM エクイティ一覧</span>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      ({computationResult.players.length}名)
                    </span>
                    <span className="table-scroll-hint mobile-only">↔ 横スクロール</span>
                  </div>
                  <button
                    type="button"
                    className="btn-export-slim"
                    onClick={handleExportCSV}
                  >
                    CSV出力
                  </button>
                </div>

                <div className="table-scroll-area">
                  <table className="icm-table">
                    <thead>
                      <tr>
                        <th className="sortable" onClick={() => handleSort('id')}>
                          Player ID {sortField === 'id' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                        </th>
                        <th>ロール</th>
                        <th className="sortable" onClick={() => handleSort('stack')}>
                          スタック {sortField === 'stack' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                        </th>
                        <th>BB</th>
                        <th className="sortable" onClick={() => handleSort('equity')}>
                          ICM エクイティ ($) {sortField === 'equity' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                        </th>
                        <th className="sortable" onClick={() => handleSort('bf')}>
                          対 {p1Player?.id || 'P1'} BF {sortField === 'bf' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                        </th>
                        <th style={{ textAlign: 'center' }}>BF対決操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPlayers.map((p) => {
                        const isP1 = p.idx === selectedP1Idx;
                        const isP2 = p.idx === selectedP2Idx;
                        const cacheKey = `${selectedP1Idx}_${p.idx}`;
                        const bfItem = bfCache[cacheKey];

                        let rowClass = '';
                        if (p.isHero) rowClass = 'row-hero';
                        else if (p.isCL) rowClass = 'row-cl';
                        if (isP1) rowClass += (rowClass ? ' ' : '') + 'row-p1-base';
                        else if (isP2) rowClass += (rowClass ? ' ' : '') + 'row-p2-selected';

                        return (
                          <tr
                            key={p.idx}
                            className={rowClass}
                            style={{ cursor: isP1 ? 'default' : 'pointer' }}
                            onClick={() => {
                              if (!isP1) handleSelectP2(p.idx);
                            }}
                          >
                            <td style={{ fontWeight: p.isHero || p.isCL || isP1 || isP2 ? 700 : 500 }}>
                              {p.id}
                              {isP1 && <span className="mini-badge-p1">P1</span>}
                              {isP2 && <span className="mini-badge-p2">P2</span>}
                            </td>
                            <td>
                              {p.isHero ? (
                                <span className="badge badge-hero">Hero</span>
                              ) : p.isCL ? (
                                <span className="badge badge-cl">CL</span>
                              ) : (
                                <span style={{ color: 'var(--text-dim)' }}>Villain</span>
                              )}
                            </td>
                            <td style={{ fontWeight: p.isHero || p.isCL ? 700 : 400 }}>
                              {Math.round(p.stack).toLocaleString()}
                            </td>
                            <td>{p.stackBB.toFixed(1)} BB</td>
                            <td style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                              ${p.equity.toFixed(2)}
                            </td>
                            <td>
                              {isP1 ? (
                                <span className="base-player-marker">基準</span>
                              ) : bfItem ? (
                                <span className="bf-mini-pill">
                                  {bfItem.p1.bubbleFactor.toFixed(3)}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
                                  未計算
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {isP1 ? (
                                <span className="badge-current-base">基準(P1)</span>
                              ) : (
                                <div className="row-action-btns">
                                  <button
                                    type="button"
                                    className={`btn-select-villain ${isP2 ? 'active' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectP2(p.idx);
                                    }}
                                    title="プレイヤー2 (相手) として選択"
                                  >
                                    {isP2 ? '相手選択中' : '相手に選択'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-set-base"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectP1(p.idx);
                                    }}
                                    title="このプレイヤーを基準(P1)に設定"
                                  >
                                    基準にする
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}