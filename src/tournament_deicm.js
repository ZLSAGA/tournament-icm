// tournament_deicm.js
// JavaScript implementation of TournamentStackModel, DEICMCalculator, DEICMBubbleFactorCalculator

/**
 * Standard Normal Inverse Cumulative Distribution Function (Acklam's Algorithm)
 * Relative error < 1.15e-9
 */
export function normPpf(p) {
  if (p <= 0.0) return -Infinity;
  if (p >= 1.0) return Infinity;

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239e0,
  ];

  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];

  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0,
  ];

  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0,
  ];

  const p_low = 0.02425;
  const p_high = 1.0 - p_low;

  if (p < p_low) {
    const q = Math.sqrt(-2.0 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    );
  } else if (p <= p_high) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
    );
  } else {
    const q = Math.sqrt(-2.0 * Math.log(1.0 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    );
  }
}

/**
 * Tournament Stack Distribution Model (Deterministic log-normal fit)
 */
export class TournamentStackModel {
  constructor({
    totalEntries,
    remainingPlayers,
    startStack,
    rebuys = 0,
    rebuyStack = 0,
    addons = 0,
    addonStack = 0,
    leaderStack = null,
    heroStack = null,
    bbSize = 1.0,
    totalChipsOverride = null,
  }) {
    this.totalEntries = Number(totalEntries);
    this.n = Number(remainingPlayers);
    this.startStack = Number(startStack);
    this.bbSize = Number(bbSize) || 1.0;
    this.heroStack = heroStack !== null && heroStack !== undefined && heroStack !== ''
      ? Number(heroStack)
      : null;

    if (totalChipsOverride !== null && totalChipsOverride !== undefined && totalChipsOverride !== '') {
      this.totalChips = Number(totalChipsOverride);
    } else {
      this.totalChips =
        this.totalEntries * this.startStack +
        Number(rebuys) * Number(rebuyStack) +
        Number(addons) * Number(addonStack);
    }

    this.avgStack = this.totalChips / this.n;

    if (leaderStack !== null && leaderStack !== undefined && leaderStack !== '') {
      this.leaderStack = Number(leaderStack);
    } else {
      this.leaderStack = this.avgStack * 2.5;
    }

    if (this.heroStack !== null && this.heroStack > this.leaderStack) {
      this.leaderStack = this.heroStack;
    }

    this.leaderStack = Math.max(this.leaderStack, this.avgStack * 1.01);

    if (this.leaderStack > this.totalChips) {
      throw new Error(
        `チップリーダーのスタック (${this.leaderStack.toLocaleString()}) が総チップ数 (${this.totalChips.toLocaleString()}) を超えています。`
      );
    }
    if (this.heroStack !== null && this.heroStack > this.totalChips) {
      throw new Error(
        `Heroのスタック (${this.heroStack.toLocaleString()}) が総チップ数 (${this.totalChips.toLocaleString()}) を超えています。`
      );
    }

    this.mu = null;
    this.sigma = null;
    this.stacks = null;
    this.heroIdx = null;
  }

  fitParameters() {
    const n = this.n;
    const S_avg = this.avgStack;
    const S_max = this.leaderStack;

    const p_max = 1.0 - 0.5 / n;
    const z_max = normPpf(p_max);

    const log_ratio = Math.log(S_max / S_avg);
    const discriminant = z_max * z_max - 2.0 * log_ratio;

    if (discriminant < 0) {
      this.sigma = 0.05;
    } else {
      this.sigma = z_max - Math.sqrt(discriminant);
    }

    this.mu = Math.log(S_avg) - (this.sigma * this.sigma) / 2.0;
  }

  generate(minBbCutoff = 0.5) {
    if (this.sigma === null) {
      this.fitParameters();
    }

    const n = this.n;
    const generatedStacks = new Float64Array(n);
    const minStackLimit = Math.max(this.bbSize * minBbCutoff, 1.0);

    for (let i = 0; i < n; i++) {
      const percentile = (i + 1 - 0.5) / n;
      const z = normPpf(percentile);
      let s = Math.exp(this.mu + this.sigma * z);
      if (s < minStackLimit) s = minStackLimit;
      generatedStacks[i] = s;
    }

    if (this.heroStack !== null) {
      if (this.heroStack >= this.leaderStack) {
        const otherTarget = this.totalChips - this.heroStack;
        let otherSum = 0;
        for (let i = 0; i < n - 1; i++) otherSum += generatedStacks[i];
        if (otherSum > 0 && otherTarget > 0) {
          const factor = otherTarget / otherSum;
          for (let i = 0; i < n - 1; i++) generatedStacks[i] *= factor;
        }
        generatedStacks[n - 1] = this.heroStack;
      } else {
        const otherTarget = this.totalChips - this.leaderStack - this.heroStack;
        let otherSum = 0;
        if (n > 2) {
          for (let i = 0; i < n - 2; i++) otherSum += generatedStacks[i];
          if (otherSum > 0 && otherTarget > 0) {
            const factor = otherTarget / otherSum;
            for (let i = 0; i < n - 2; i++) generatedStacks[i] *= factor;
          }
        }
        if (n >= 2) {
          generatedStacks[n - 2] = this.heroStack;
          generatedStacks[n - 1] = this.leaderStack;
        } else {
          generatedStacks[0] = this.heroStack;
        }
      }
    } else {
      const otherTarget = this.totalChips - this.leaderStack;
      let otherSum = 0;
      for (let i = 0; i < n - 1; i++) otherSum += generatedStacks[i];
      if (otherSum > 0 && otherTarget > 0) {
        const factor = otherTarget / otherSum;
        for (let i = 0; i < n - 1; i++) generatedStacks[i] *= factor;
      }
      generatedStacks[n - 1] = this.leaderStack;
    }

    // Sort ascending
    const sorted = Array.from(generatedStacks).sort((a, b) => a - b);
    this.stacks = new Float64Array(sorted);

    if (this.heroStack !== null) {
      let minDiff = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < n; i++) {
        const diff = Math.abs(this.stacks[i] - this.heroStack);
        if (diff < minDiff) {
          minDiff = diff;
          bestIdx = i;
        }
      }
      this.heroIdx = bestIdx;
    }

    return this.stacks;
  }

  getSummary() {
    if (this.stacks === null) {
      this.generate();
    }

    const s = this.stacks;
    const n = this.n;
    const bb = this.bbSize;
    const k = Math.max(1, Math.floor(n * 0.1));

    let topKSum = 0;
    for (let i = n - k; i < n; i++) topKSum += s[i];
    const topKMean = topKSum / k;

    let botKSum = 0;
    for (let i = 0; i < k; i++) botKSum += s[i];
    const botKMean = botKSum / k;

    const median =
      n % 2 === 1 ? s[Math.floor(n / 2)] : (s[n / 2 - 1] + s[n / 2]) / 2;

    return {
      remainingPlayers: n,
      totalChips: this.totalChips,
      avgStack: this.avgStack,
      medianStack: median,
      minStack: s[0],
      maxStack: s[n - 1],
      heroStack: this.heroStack,
      heroIdx: this.heroIdx,
      topPctMean: topKMean,
      botPctMean: botKMean,
      kPct: Math.floor((k / n) * 100),
      sigma: this.sigma,
      bbSize: bb,
    };
  }
}

/**
 * DE-ICM Calculator Engine (Inariba, 2026)
 */
export class DEICMCalculator {
  static calculateDeIcm(stacks, prizes) {
    const n = stacks.length;
    const m = prizes.length;

    if (n === 0 || prizes.length === 0) {
      return {
        Q: Array.from({ length: n }, () => new Float64Array(m)),
        equities: new Float64Array(n),
      };
    }

    let stackSum = 0;
    for (let i = 0; i < n; i++) stackSum += stacks[i];
    if (stackSum <= 0) {
      return {
        Q: Array.from({ length: n }, () => new Float64Array(m)),
        equities: new Float64Array(n),
      };
    }

    // 1. Sort indices
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => stacks[a] - stacks[b]);

    const s_sorted = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      s_sorted[i] = stacks[indices[i]];
    }

    const s_max = s_sorted[n - 1];
    const c = 20.0;
    const s_tilde = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      s_tilde[i] = s_sorted[i] / (c * s_max);
    }

    // 2. Step size h
    let h;
    if (n <= 50) h = 1.0 / 8.0;
    else if (n <= 200) h = 1.0 / 16.0;
    else if (n <= 1000) h = 1.0 / 32.0;
    else h = 1.0 / 64.0;

    const x_L = -3.75;
    const x_R = 27.5;

    // Q_hat matrix of size n x m
    const Q_hat = Array.from({ length: n }, () => new Float64Array(m));

    const q_arr = new Float64Array(n);
    const p_arr = new Float64Array(n);
    let C = new Float64Array(n + 1);
    let C_next = new Float64Array(n + 1);

    // 3. Numerical quadrature
    for (let x = x_L; x < x_R; x += h) {
      const exp_neg_x = Math.exp(-x);
      const t = Math.exp(x - exp_neg_x);
      const w = h * (1.0 + exp_neg_x) * t;

      let b = 0;
      for (let j = 0; j < n; j++) {
        const arg = -s_tilde[j] * t;
        const q_val = Math.exp(arg);
        q_arr[j] = q_val;
        p_arr[j] = -Math.expm1(arg);
        if (q_val >= 0.5) b++;
      }

      // DP convolution
      C.fill(0);
      C[0] = 1.0;

      for (let j = 0; j < n; j++) {
        C_next.fill(0);
        const qj = q_arr[j];
        const pj = p_arr[j];
        C_next[0] = C[0] * qj;
        for (let k = 1; k <= j + 1; k++) {
          C_next[k] = C[k] * qj + C[k - 1] * pj;
        }
        const temp = C;
        C = C_next;
        C_next = temp;
      }

      // Forward group (0 <= i < b)
      for (let i = 0; i < b; i++) {
        let E_prev = 0.0;
        const p_over_q = p_arr[i] / q_arr[i];
        for (let r = 0; r < m; r++) {
          const Cr = C[r];
          const val = Cr - p_over_q * E_prev;
          const E_curr = val < 0.0 ? 0.0 : val > Cr ? Cr : val;
          Q_hat[i][r] += w * E_curr;
          E_prev = E_curr;
        }
      }

      // Backward group (b <= i < n)
      for (let i = b; i < n; i++) {
        let E_next = 0.0;
        const q_over_p = q_arr[i] / p_arr[i];
        for (let r = n; r >= 1; r--) {
          const val = q_over_p * (C[r] - E_next);
          const Cr_1 = C[r - 1];
          const E_prev = val < 0.0 ? 0.0 : val > Cr_1 ? Cr_1 : val;
          if (r <= m) {
            Q_hat[i][r - 1] += w * E_prev;
          }
          E_next = E_prev;
        }
      }
    }

    // 4. Multiply by s_tilde
    for (let i = 0; i < n; i++) {
      const st = s_tilde[i];
      for (let r = 0; r < m; r++) {
        Q_hat[i][r] *= st;
      }
    }

    // 5. Restore original order
    const Q_final = Array.from({ length: n }, () => new Float64Array(m));
    for (let i = 0; i < n; i++) {
      Q_final[indices[i]] = Q_hat[i];
    }

    // 6. Equities = Q_final @ prizes
    const equities = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let eq = 0;
      const row = Q_final[i];
      for (let r = 0; r < m; r++) {
        eq += row[r] * prizes[r];
      }
      equities[i] = eq;
    }

    return { Q: Q_final, equities };
  }

  static calculateFromModel(model, prizes, minBbCutoff = 0.5) {
    const stacks = model.generate(minBbCutoff);
    const { Q, equities } = DEICMCalculator.calculateDeIcm(stacks, prizes);
    return { stacks, Q, equities };
  }
}

/**
 * Bubble Factor Calculator using DE-ICM
 */
export class DEICMBubbleFactorCalculator {
  static calculateBf({
    stacks,
    prizes,
    heroIdx,
    villainIdx,
    baseEquities = null,
  }) {
    const heroStack = stacks[heroIdx];
    const villainStack = stacks[villainIdx];
    const effStack = Math.min(heroStack, villainStack);

    let eqBase;
    if (baseEquities) {
      eqBase = baseEquities[heroIdx];
    } else {
      const res = DEICMCalculator.calculateDeIcm(stacks, prizes);
      eqBase = res.equities[heroIdx];
    }

    // 1. Hero Win Scenario
    const winStacks = Array.from(stacks);
    winStacks[heroIdx] += effStack;
    winStacks[villainIdx] -= effStack;

    let newHeroIdx = heroIdx;
    let finalWinStacks;
    if (winStacks[villainIdx] <= 0) {
      finalWinStacks = winStacks.filter((_, idx) => idx !== villainIdx);
      newHeroIdx = heroIdx < villainIdx ? heroIdx : heroIdx - 1;
    } else {
      finalWinStacks = winStacks;
    }

    const winRes = DEICMCalculator.calculateDeIcm(
      new Float64Array(finalWinStacks),
      prizes
    );
    const eqWin = winRes.equities[newHeroIdx];

    // 2. Hero Loss Scenario
    const lossStacks = Array.from(stacks);
    lossStacks[heroIdx] -= effStack;
    lossStacks[villainIdx] += effStack;

    let eqLoss = 0.0;
    if (lossStacks[heroIdx] > 0) {
      const lossRes = DEICMCalculator.calculateDeIcm(
        new Float64Array(lossStacks),
        prizes
      );
      eqLoss = lossRes.equities[heroIdx];
    }

    // 3. Gain, Risk, BF
    const gain = eqWin - eqBase;
    const risk = eqBase - eqLoss;

    let bf;
    if (gain <= 1e-9) {
      bf = 999.0;
    } else {
      bf = risk / gain;
    }

    const minWinRate = bf < 999.0 ? bf / (bf + 1.0) : 1.0;

    let coverStatus;
    if (heroStack > villainStack) {
      coverStatus = 'Covering (カバー中)';
    } else if (heroStack < villainStack) {
      coverStatus = 'Covered (被カバー)';
    } else {
      coverStatus = 'Equal (同スタック)';
    }

    return {
      heroIdx,
      villainIdx,
      heroStack,
      villainStack,
      effectiveStack: effStack,
      coverStatus,
      eqBase,
      eqWin,
      eqLoss,
      gain,
      risk,
      bubbleFactor: Number(bf.toFixed(3)),
      minWinRateRequired: (minWinRate * 100).toFixed(1) + '%',
      minWinRateVal: minWinRate,
    };
  }
}
