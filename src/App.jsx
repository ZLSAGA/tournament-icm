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

  // Selected villain & BF Result
  const [selectedVillainIdx, setSelectedVillainIdx] = useState(null);
  const [activeBfResult, setActiveBfResult] = useState(null);
  const [bfCache, setBfCache] = useState({});

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

      setSelectedVillainIdx(null);
      setActiveBfResult(null);
      setBfCache({});
      setIsDirty(false);
    } catch (err) {
      setComputationResult({ error: err.message });
    } finally {
      setIsCalculating(false);
    }
  }, []);

  // BF calculation on-demand for selected player
  const handleSelectVillain = useCallback(
    (villainIdx) => {
      if (!computationResult.success) return;
      const { heroIdx, stacks, validPrizes, equities } = computationResult;

      if (villainIdx === heroIdx || villainIdx === null || villainIdx === undefined) {
        return;
      }

      setSelectedVillainIdx(villainIdx);

      if (bfCache[villainIdx]) {
        setActiveBfResult(bfCache[villainIdx]);
        return;
      }

      setIsBfCalculating(true);
      setTimeout(() => {
        try {
          const bfData = DEICMBubbleFactorCalculator.calculateBf({
            stacks,
            prizes: validPrizes,
            heroIdx,
            villainIdx,
            baseEquities: equities,
          });

          setActiveBfResult(bfData);
          setBfCache((prev) => ({ ...prev, [villainIdx]: bfData }));
        } finally {
          setIsBfCalculating(false);
        }
      }, 10);
    },
    [computationResult, bfCache]
  );

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
        const bfA = bfCache[a.idx] ? bfCache[a.idx].bubbleFactor : 0;
        const bfB = bfCache[b.idx] ? bfCache[b.idx].bubbleFactor : 0;
        comp = bfA - bfB;
      }
      return sortDirection === 'desc' ? -comp : comp;
    });
    return list;
  }, [computationResult.players, sortField, sortDirection, bfCache]);

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
    const headers = [
      'Player_ID',
      'Role',
      'Stack',
      'Stack_BB',
      'Chip_Share_Pct',
      'ICM_Equity_Dollar',
      'Equity_Share_Pct',
      'Bubble_Factor_vs_Hero',
    ];

    const rows = players.map((p) => [
      p.id,
      p.role,
      Math.round(p.stack),
      p.stackBB.toFixed(1),
      p.chipPct.toFixed(2) + '%',
      p.equity.toFixed(2),
      p.equityPct.toFixed(2) + '%',
      bfCache[p.idx] ? bfCache[p.idx].bubbleFactor : '-',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'tournament_deicm_results.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
              {/* Summary Metrics Bar (1-row slim: 総チップ, 平均スタック, Blind, Hero, Chipleader) */}
              <div className="stats-summary-slim">
                {/* 1. TOTAL STACK */}
                <div className="stat-box-slim">
                  <span className="stat-label-slim">TOTAL STACK</span>
                  <span className="stat-value-slim">
                    {computationResult.totalChips.toLocaleString()}
                  </span>
                  <span className="stat-sub-slim">
                    残り {computationResult.summary.remainingPlayers} 名
                  </span>
                </div>

                {/* 2. AVG STACK */}
                <div className="stat-box-slim">
                  <span className="stat-label-slim">AVG STACK</span>
                  <span className="stat-value-slim">
                    {Math.round(computationResult.summary.avgStack).toLocaleString()}
                  </span>
                  <span className="stat-sub-slim">
                    {(computationResult.summary.avgStack / computationResult.bbSize).toFixed(1)} BB
                  </span>
                </div>

                {/* 3. Blind */}
                <div className="stat-box-slim">
                  <span className="stat-label-slim">Blind</span>
                  <span className="stat-value-slim">
                    {computationResult.bbSize.toLocaleString()}
                  </span>
                  <span className="stat-sub-slim">
                    総チップ計 {(computationResult.totalChips / computationResult.bbSize).toFixed(0)} BB
                  </span>
                </div>

                {/* 4. Hero */}
                <div className="stat-box-slim highlight-hero">
                  <span className="stat-label-slim">
                    Hero <span className="badge badge-hero">Hero</span>
                  </span>
                  <span className="stat-value-slim" style={{ color: 'var(--hero-color)' }}>
                    {Number(computationResult.players[computationResult.heroIdx]?.stack).toLocaleString()}
                  </span>
                  <span className="stat-sub-slim">
                    {computationResult.players[computationResult.heroIdx]?.stackBB.toFixed(1)} BB (
                    {computationResult.players[computationResult.heroIdx]?.chipPct.toFixed(1)}%)
                  </span>
                </div>

                {/* 5. Chipleader */}
                <div className="stat-box-slim highlight-cl">
                  <span className="stat-label-slim">
                    Chipleader <span className="badge badge-cl">CL</span>
                  </span>
                  <span className="stat-value-slim" style={{ color: 'var(--cl-color)' }}>
                    {Number(computationResult.players[computationResult.leaderIdx]?.stack).toLocaleString()}
                  </span>
                  <span className="stat-sub-slim">
                    {computationResult.players[computationResult.leaderIdx]?.stackBB.toFixed(1)} BB (
                    {computationResult.players[computationResult.leaderIdx]?.chipPct.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {/* Compact Bubble Factor Panel */}
              <div className="bf-panel-compact">
                <div className="bf-header-compact">
                  <div className="bf-title-compact">
                    <span>バブルファクター分析</span>
                  </div>
                  <div className="villain-select-wrap">
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      相手を選択:
                    </label>
                    <select
                      className="villain-select"
                      value={selectedVillainIdx !== null ? selectedVillainIdx : ''}
                      onChange={(e) => handleSelectVillain(Number(e.target.value))}
                    >
                      <option value="" disabled>-- 相手を選択 --</option>
                      {computationResult.players
                        .filter((p) => !p.isHero)
                        .map((p) => (
                          <option key={p.idx} value={p.idx}>
                            {p.id} {p.isCL ? '(CL)' : ''} - {Math.round(p.stack).toLocaleString()} ({p.stackBB.toFixed(1)} BB)
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {isBfCalculating ? (
                  <div className="bf-loading">
                    <span>選択された相手とのBFを計算中...</span>
                  </div>
                ) : activeBfResult ? (
                  <div>
                    <div className="bf-content-compact">
                      <div className="bf-score-card-compact">
                        <div className="bf-score-row">
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 700 }}>BF</span>
                          <span className="bf-number-compact">{activeBfResult.bubbleFactor.toFixed(3)}</span>
                          <span
                            className={`badge ${
                              activeBfResult.coverStatus.includes('Covered')
                                ? 'badge-covered'
                                : activeBfResult.coverStatus.includes('Covering')
                                ? 'badge-covering'
                                : 'badge-equal'
                            }`}
                          >
                            {activeBfResult.coverStatus}
                          </span>
                        </div>
                        <div className="bf-winrate-inline">
                          <span style={{ color: 'var(--text-dim)' }}>必要勝率:</span>
                          <span className="bf-winrate-val-compact">{activeBfResult.minWinRateRequired}</span>
                        </div>
                      </div>

                      <div className="bf-metrics-row">
                        <div className="bf-metric-compact">
                          <span className="bf-metric-label-compact">スタック</span>
                          <div className="bf-metric-val-compact">
                            {Math.round(activeBfResult.effectiveStack).toLocaleString()} (
                            {(activeBfResult.effectiveStack / computationResult.bbSize).toFixed(1)} BB)
                          </div>
                        </div>

                        <div className="bf-metric-compact">
                          <span className="bf-metric-label-compact">勝利時スタック</span>
                          <div className="bf-metric-val-compact gain-text">
                            {Math.round(activeBfResult.winStack).toLocaleString()} (
                            {(activeBfResult.winStack / computationResult.bbSize).toFixed(1)} BB)
                          </div>
                        </div>

                        <div className="bf-metric-compact">
                          <span className="bf-metric-label-compact">敗北時スタック</span>
                          <div className="bf-metric-val-compact risk-text">
                            {Math.round(activeBfResult.lossStack).toLocaleString()} (
                            {(activeBfResult.lossStack / computationResult.bbSize).toFixed(1)} BB)
                          </div>
                        </div>

                        <div className="bf-metric-compact">
                          <span className="bf-metric-label-compact">基準エクイティ</span>
                          <div className="bf-metric-val-compact">
                            ${activeBfResult.eqBase.toFixed(2)}
                          </div>
                        </div>

                        <div className="bf-metric-compact">
                          <span className="bf-metric-label-compact">勝利時エクイティ</span>
                          <div className="bf-metric-val-compact gain-text">
                            ${activeBfResult.eqWin.toFixed(2)}{' '}
                            <small>(+${activeBfResult.gain.toFixed(2)})</small>
                          </div>
                        </div>

                        <div className="bf-metric-compact">
                          <span className="bf-metric-label-compact">敗北時エクイティ</span>
                          <div className="bf-metric-val-compact risk-text">
                            ${activeBfResult.eqLoss.toFixed(2)}{' '}
                            <small>(-${activeBfResult.risk.toFixed(2)})</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bf-placeholder">
                    下記の表の行をクリックするか、右上のプルダウンから相手を選択すると、その相手とのBFと必要勝率を瞬時に計算します。
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
                        <th>チップシェア</th>
                        <th className="sortable" onClick={() => handleSort('equity')}>
                          ICM エクイティ ($) {sortField === 'equity' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                        </th>
                        <th>エクイティ シェア</th>
                        <th className="sortable" onClick={() => handleSort('bf')}>
                          対Hero BF {sortField === 'bf' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                        </th>
                        <th style={{ textAlign: 'center' }}>BF分析</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPlayers.map((p) => {
                        const isSelectedVillain = p.idx === selectedVillainIdx;
                        let rowClass = '';
                        if (p.isHero) rowClass = 'row-hero';
                        else if (p.isCL) rowClass = 'row-cl';
                        if (isSelectedVillain)
                          rowClass += (rowClass ? ' ' : '') + 'row-selected-villain';

                        return (
                          <tr
                            key={p.idx}
                            className={rowClass}
                            style={{ cursor: p.isHero ? 'default' : 'pointer' }}
                            onClick={() => {
                              if (!p.isHero) handleSelectVillain(p.idx);
                            }}
                          >
                            <td style={{ fontWeight: p.isHero || p.isCL ? 700 : 500 }}>
                              {p.id}
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
                            <td>
                              <div className="share-bar-container">
                                <div className="share-bar-bg">
                                  <div
                                    className={`share-bar-fill ${
                                      p.isHero ? 'hero' : p.isCL ? 'cl' : ''
                                    }`}
                                    style={{ width: `${Math.min(100, p.chipPct * 2)}%` }}
                                  />
                                </div>
                                <span>{p.chipPct.toFixed(2)}%</span>
                              </div>
                            </td>
                            <td style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                              ${p.equity.toFixed(2)}
                            </td>
                            <td>{p.equityPct.toFixed(2)}%</td>
                            <td>
                              {p.isHero ? (
                                <span style={{ color: 'var(--text-dim)' }}>-</span>
                              ) : bfCache[p.idx] ? (
                                <span className="bf-mini-pill">
                                  {bfCache[p.idx].bubbleFactor.toFixed(3)}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
                                  未計算
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {!p.isHero && (
                                <button
                                  type="button"
                                  className={`btn-select-villain ${
                                    isSelectedVillain ? 'active' : ''
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectVillain(p.idx);
                                  }}
                                >
                                  {isSelectedVillain ? '選択中' : 'BFを計算'}
                                </button>
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