import csv
import math
import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import norm

# ==============================================================================
# Component 1: Tournament Stack Model (tutorial-model.py の完全移植＆拡張)
# ==============================================================================


class TournamentStackModel:
    """トーナメントの集計情報から、全体（n人分）のスタック分布モデルを決定論的に生成するクラス"""

    def __init__(
        self,
        total_entries: int,
        remaining_players: int,
        start_stack: float,
        rebuys: int = 0,
        rebuy_stack: float = 0,
        addons: int = 0,
        addon_stack: float = 0,
        leader_stack: float = None,
        hero_stack: float = None,  # 【機能追加】Heroのスタック手入力用
        bb_size: float = 1.0,
        total_chips_override: float = None,
    ):
        self.total_entries = total_entries
        self.n = remaining_players
        self.start_stack = start_stack
        self.bb_size = bb_size
        self.hero_stack = float(hero_stack) if hero_stack is not None else None

        # 総チップ数の算出
        if total_chips_override is not None:
            self.total_chips = float(total_chips_override)
        else:
            self.total_chips = (
                (total_entries * start_stack)
                + (rebuys * rebuy_stack)
                + (addons * addon_stack)
            )

        self.avg_stack = self.total_chips / self.n

        # チップリーダーのスタック設定
        if leader_stack is not None:
            self.leader_stack = float(leader_stack)
        else:
            self.leader_stack = self.avg_stack * 2.5

        # HeroスタックがCLより大きい場合はCLをHeroスタックに合わせる
        if self.hero_stack is not None and self.hero_stack > self.leader_stack:
            self.leader_stack = self.hero_stack

        self.leader_stack = max(self.leader_stack, self.avg_stack * 1.01)

        # 整合性チェック
        if self.leader_stack > self.total_chips:
            raise ValueError(
                f"チップリーダーのスタック({self.leader_stack})が総チップ数({self.total_chips})を超えています。"
            )
        if self.hero_stack is not None and self.hero_stack > self.total_chips:
            raise ValueError(
                f"Heroのスタック({self.hero_stack})が総チップ数({self.total_chips})を超えています。"
            )

        self.mu = None
        self.sigma = None
        self.stacks = None
        self.hero_idx = None  # 自動決定されるHeroのインデックス

    def fit_parameters(self):
        """S_avg, S_max, n から対数正規分布のパラメータ (mu, sigma) を逆算"""
        n = self.n
        S_avg = self.avg_stack
        S_max = self.leader_stack

        p_max = 1.0 - (0.5 / n)
        z_max = norm.ppf(p_max)

        log_ratio = np.log(S_max / S_avg)
        discriminant = z_max**2 - 2.0 * log_ratio

        if discriminant < 0:
            self.sigma = 0.05
        else:
            self.sigma = z_max - np.sqrt(discriminant)

        self.mu = np.log(S_avg) - (self.sigma**2) / 2.0

    def generate(self, min_bb_cutoff: float = 0.5) -> np.ndarray:
        """スタック配列を決定論的に生成・スケーリング（昇順ソート済み）"""
        if self.sigma is None:
            self.fit_parameters()

        n = self.n
        percentiles = (np.arange(1, n + 1) - 0.5) / n
        z_scores = norm.ppf(percentiles)

        # 対数正規分布から基本スタックを生成
        generated_stacks = np.exp(self.mu + self.sigma * z_scores)

        # 最小スタックの下限処理
        min_stack_limit = max(self.bb_size * min_bb_cutoff, 1.0)
        generated_stacks = np.maximum(generated_stacks, min_stack_limit)

        if self.hero_stack is not None:
            # Heroスタックが指定されている場合
            if self.hero_stack >= self.leader_stack:
                # Heroがチップリーダーの場合 (残り n-1 人をスケーリング)
                other_target = self.total_chips - self.hero_stack
                other_sum = np.sum(generated_stacks[:-1])
                if other_sum > 0 and other_target > 0:
                    generated_stacks[:-1] *= other_target / other_sum
                generated_stacks[-1] = self.hero_stack
            else:
                # Heroとチップリーダーの両方を固定する場合 (残り n-2 人をスケーリング)
                other_target = self.total_chips - self.leader_stack - self.hero_stack
                other_sum = np.sum(generated_stacks[:-2]) if n > 2 else 0

                if other_sum > 0 and other_target > 0:
                    generated_stacks[:-2] *= other_target / other_sum

                generated_stacks[-2] = self.hero_stack
                generated_stacks[-1] = self.leader_stack
        else:
            # Heroスタックの指定がない場合 (チップリーダーのみ固定)
            other_target = self.total_chips - self.leader_stack
            other_sum = np.sum(generated_stacks[:-1])

            if other_sum > 0 and other_target > 0:
                generated_stacks[:-1] *= other_target / other_sum

            generated_stacks[-1] = self.leader_stack

        self.stacks = np.sort(generated_stacks)

        # Heroのインデックス（配列位置）を自動算出
        if self.hero_stack is not None:
            self.hero_idx = int(np.argmin(np.abs(self.stacks - self.hero_stack)))

        return self.stacks

    def get_summary(self) -> dict:
        """分布の要約統計量を取得"""
        if self.stacks is None:
            self.generate()

        s = self.stacks
        bb = self.bb_size

        # 人数が少ない場合でも最低1名は取得するように修正 (nanエラー防止)
        k = max(1, int(self.n * 0.1))

        summary = {
            "残り人数": self.n,
            "総チップ数": f"{self.total_chips:,.0f}",
            "平均スタック": f"{self.avg_stack:,.0f} ({self.avg_stack/bb:.1f} BB)",
            "中央値スタック": f"{np.median(s):,.0f} ({np.median(s)/bb:.1f} BB)",
            "最小スタック": f"{s[0]:,.0f} ({s[0]/bb:.1f} BB)",
            "最大スタック(CL)": f"{s[-1]:,.0f} ({s[-1]/bb:.1f} BB)",
        }

        if self.hero_stack is not None:
            summary["Heroスタック (入力値)"] = (
                f"{self.hero_stack:,.0f} ({self.hero_stack/bb:.1f} BB) [P_{self.hero_idx:03d}]"
            )

        summary[f"上位{int(k/self.n*100)}%平均"] = (
            f"{np.mean(s[-k:]):,.0f} ({np.mean(s[-k:])/bb:.1f} BB)"
        )
        summary[f"下位{int(k/self.n*100)}%平均"] = (
            f"{np.mean(s[:k]):,.0f} ({np.mean(s[:k])/bb:.1f} BB)"
        )
        summary["推定パラメータ(sigma)"] = round(float(self.sigma), 4)

        return summary


# ==============================================================================
# Component 2: DE-ICM Calculator Engine (tutorial-deicm.py の完全移植＆連携ラッパー)
# ==============================================================================


class DEICMCalculator:
    """論文 (Inariba, 2026) に基づく DE-ICM 決定論的アルゴリズム計算エンジン"""

    @staticmethod
    def calculate_de_icm(
        stacks: np.ndarray, prizes: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """配列形式のスタックと賞金から Q 行列とエクイティを計算"""
        stacks = np.array(stacks, dtype=np.float64)
        prizes = np.array(prizes, dtype=np.float64)
        n = len(stacks)
        m = len(prizes)

        if n == 0 or np.sum(stacks) <= 0:
            return np.zeros((n, m)), np.zeros(n)

        # 1. ソートと正規化 (s_tilde)
        sort_idx = np.argsort(stacks)
        s_sorted = stacks[sort_idx]
        s_max = s_sorted[-1]
        c = 20.0
        s_tilde = s_sorted / (c * s_max)

        # 2. ステップサイズ h の決定
        if n <= 50:
            h = 1 / 8
        elif n <= 200:
            h = 1 / 16
        elif n <= 1000:
            h = 1 / 32
        else:
            h = 1 / 64

        x_L, x_R = -3.75, 27.5
        x_nodes = np.arange(x_L, x_R, h)

        Q_hat = np.zeros((n, m), dtype=np.float64)

        # 3. 数値積分ノード計算
        for x in x_nodes:
            exp_neg_x = np.exp(-x)
            t = np.exp(x - exp_neg_x)
            w = h * (1.0 + exp_neg_x) * t

            q = np.exp(-s_tilde * t)
            p = -np.expm1(-s_tilde * t)

            # DP 畳み込み
            C = np.zeros(n + 1, dtype=np.float64)
            C[0] = 1.0
            for j in range(n):
                C_next = np.zeros(n + 1, dtype=np.float64)
                C_next[0] = C[0] * q[j]
                C_next[1:] = C[1:] * q[j] + C[:-1] * p[j]
                C = C_next

            b = np.sum(q >= 0.5)

            # Forward グループ
            for i in range(b):
                E_prev = 0.0
                p_over_q = p[i] / q[i]
                for r in range(m):
                    val = C[r] - p_over_q * E_prev
                    E_curr = np.clip(val, 0.0, C[r])
                    Q_hat[i, r] += w * E_curr
                    E_prev = E_curr

            # Backward グループ
            for i in range(b, n):
                E_next = 0.0
                q_over_p = q[i] / p[i]
                for r in range(n, 0, -1):
                    val = q_over_p * (C[r] - E_next)
                    E_prev = np.clip(val, 0.0, C[r - 1])
                    if r <= m:
                        Q_hat[i, r - 1] += w * E_prev
                    E_next = E_prev

        # 4. スケーリング復元
        for i in range(n):
            Q_hat[i, :] *= s_tilde[i]

        # 5. 元の順序に並び替え
        Q_final = np.zeros_like(Q_hat)
        Q_final[sort_idx] = Q_hat

        # 6. エクイティ計算
        equities = Q_final @ prizes
        return Q_final, equities

    @classmethod
    def calculate_from_model(
        cls,
        model: TournamentStackModel,
        prizes: np.ndarray,
        min_bb_cutoff: float = 0.5,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """【連携インターフェース】TournamentStackModel オブジェクトを直接入力して計算を行う"""
        stacks = model.generate(min_bb_cutoff=min_bb_cutoff)
        Q, equities = cls.calculate_de_icm(stacks, prizes)
        return stacks, Q, equities


# ==============================================================================
# Component 3: Bubble Factor Analysis Engine (DE-ICM を利用した分析)
# ==============================================================================


class DEICMBubbleFactorCalculator:
    """DE-ICM エンジンを使用したバブルファクター (BF) 計算クラス"""

    def __init__(self, icm_calculator: DEICMCalculator):
        self.icm_calc = icm_calculator

    def calculate_bf(
        self,
        stacks: np.ndarray,
        prizes: np.ndarray,
        hero_idx: int,
        villain_idx: int,
        base_equities: np.ndarray = None,
    ) -> dict:
        """特定の Hero 対 特定の Villain との衝突における BF 計算"""
        hero_stack = stacks[hero_idx]
        villain_stack = stacks[villain_idx]
        eff_stack = min(hero_stack, villain_stack)

        # ベースラインのエクイティが渡されていない場合は算定
        if base_equities is None:
            _, base_equities = self.icm_calc.calculate_de_icm(stacks, prizes)

        eq_base = base_equities[hero_idx]

        # 1. Hero 勝利シナリオ
        win_stacks = stacks.copy()
        win_stacks[hero_idx] += eff_stack
        win_stacks[villain_idx] -= eff_stack

        if win_stacks[villain_idx] <= 0:
            win_stacks = np.delete(win_stacks, villain_idx)
            new_hero_idx = hero_idx if hero_idx < villain_idx else hero_idx - 1
        else:
            new_hero_idx = hero_idx

        _, win_equities = self.icm_calc.calculate_de_icm(win_stacks, prizes)
        eq_win = win_equities[new_hero_idx]

        # 2. Hero 敗北シナリオ
        loss_stacks = stacks.copy()
        loss_stacks[hero_idx] -= eff_stack
        loss_stacks[villain_idx] += eff_stack

        if loss_stacks[hero_idx] <= 0:
            eq_loss = 0.0
        else:
            _, loss_equities = self.icm_calc.calculate_de_icm(
                loss_stacks, prizes
            )
            eq_loss = loss_equities[hero_idx]

        # 3. ゲイン・リスク・BF 算出
        gain = eq_win - eq_base
        risk = eq_base - eq_loss

        if gain <= 1e-9:
            bf = 999.0
        else:
            bf = risk / gain

        min_win_rate = bf / (bf + 1.0) if bf < 999.0 else 1.0

        # カバー関係の判定
        if hero_stack > villain_stack:
            cover_status = "Covering (カバー中)"
        elif hero_stack < villain_stack:
            cover_status = "Covered (被カバー)"
        else:
            cover_status = "Equal (同スタック)"

        return {
            "hero_idx": hero_idx,
            "villain_idx": villain_idx,
            "hero_stack": hero_stack,
            "villain_stack": villain_stack,
            "effective_stack": eff_stack,
            "cover_status": cover_status,
            "eq_base": eq_base,
            "eq_win": eq_win,
            "eq_loss": eq_loss,
            "gain": gain,
            "risk": risk,
            "bubble_factor": round(bf, 3),
            "min_win_rate_required": f"{min_win_rate * 100:.1f}%",
        }


# ==============================================================================
# Component 4: Export and Visualization Utilities
# ==============================================================================


class TournamentDataExporter:
    """CSVおよびTXTサマリー出力ユーティリティ"""

    @staticmethod
    def export_to_csv(
        filename: str,
        stacks: np.ndarray,
        equities: np.ndarray,
        bb_size: float,
        hero_idx: int = None,
    ):
        total_chips = np.sum(stacks)
        total_prize = np.sum(equities)

        with open(filename, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "Player_ID",
                    "Role",
                    "Stack",
                    "Stack_BB",
                    "Chip_Share_Pct",
                    "ICM_Equity_Dollar",
                    "Equity_Share_Pct",
                ]
            )

            for i, (s, eq) in enumerate(zip(stacks, equities)):
                role = "Hero" if i == hero_idx else ("CL" if i == len(stacks) - 1 else "Villain")
                chip_pct = (s / total_chips) * 100.0
                eq_pct = (
                    (eq / total_prize) * 100.0 if total_prize > 0 else 0.0
                )
                writer.writerow(
                    [
                        f"P_{i:03d}",
                        role,
                        f"{s:.0f}",
                        f"{s / bb_size:.1f}",
                        f"{chip_pct:.2f}%",
                        f"{eq:.2f}",
                        f"{eq_pct:.2f}%",
                    ]
                )
        print(f" CSVを出力しました: {filename}")


# ==============================================================================
# Main Execution Area (統合動作デモ)
# ==============================================================================
if __name__ == "__main__":
    print("==================================================")
    print(" 1. スタックモデル構築 (TournamentStackModel)")
    print("==================================================")

    # 【手入力設定エリア】
    user_total_entries = 279
    user_remaining_players = 9
    user_start_stack = 5000
    user_leader_stack = 476329  # チップリーダーのスタック
    user_hero_stack = 120062    # ★ Heroのスタック手入力
    user_bb_size = 15000

    # モデルインスタンス構築
    model = TournamentStackModel(
        total_entries=user_total_entries,
        remaining_players=user_remaining_players,
        start_stack=user_start_stack,
        leader_stack=user_leader_stack,
        hero_stack=user_hero_stack,  # 手入力したHeroスタックを渡す
        bb_size=user_bb_size,
    )

    for k, v in model.get_summary().items():
        print(f"  {k:20s}: {v}")

    print("\n==================================================")
    print(" 2. 全プレイヤーの ICM エクイティ計算結果 (全件出力)")
    print("==================================================")

    # 上位3名が各 $5,000 獲得（サテライト構造）
    prizes = np.array([5000, 5000, 5000])

    # モデルインスタンスを直接 DEICMCalculator に入力
    stacks, Q_matrix, equities = DEICMCalculator.calculate_from_model(
        model=model, prizes=prizes
    )

    total_chips = np.sum(stacks)
    total_prize = np.sum(equities)

    print(
        f"{'Player_ID':<12} | {'Stack':<12} | {'Stack(BB)':<10} | {'Chip Share':<10} | {'Equity ($)':<12} | {'Equity Share'}"
    )
    print("-" * 85)

    # 全プレイヤー分を一覧出力
    for i in range(len(stacks)):
        chip_pct = (stacks[i] / total_chips) * 100.0
        eq_pct = (equities[i] / total_prize) * 100.0 if total_prize > 0 else 0.0

        # ロールの表示（Hero, CLなど）
        role = ""
        if i == model.hero_idx:
            role += " (Hero★)"
        if i == len(stacks) - 1:
            role += " (CL)"

        player_id = f"P_{i:03d}{role}"

        print(
            f"Player {player_id:<7} | {stacks[i]:10,.0f} | {stacks[i]/model.bb_size:8.1f} BB | {chip_pct:8.2f}% | ${equities[i]:9,.2f} | {eq_pct:8.2f}%"
        )

    print("\n==================================================")
    print(" 3. バブルファクター (BF) 分析 (CL & 指定相手のみ)")
    print("==================================================")

    bf_calc = DEICMBubbleFactorCalculator(DEICMCalculator())

    hero_idx = model.hero_idx     # 自動特定されたHeroのインデックス
    target_villain_idx = 1        # 手入力指定された対戦相手 (例: Heroがカバーしている特定プレイヤー)
    leader_idx = len(stacks) - 1  # チップリーダー (CL)

    # 重複を防ぎつつ、チップリーダーと指定相手のインデックスリストを作成
    targets = [leader_idx]
    if target_villain_idx != leader_idx and target_villain_idx != hero_idx:
        targets.append(target_villain_idx)

    print(f"【Hero】: Player P_{hero_idx:03d}")
    print(f"  Hero スタック : {stacks[hero_idx]:,.0f} ({stacks[hero_idx]/model.bb_size:.1f} BB)")
    print(f"  ベースエクイティ: ${equities[hero_idx]:,.2f}\n")

    print(
        f"{'対戦相手 (Villain)':<22} | {'Villain Stack':<18} | {'Eff Stack':<16} | {'カバー関係':<20} | {'BF':<8} | {'必要勝率'}"
    )
    print("-" * 105)

    for v_idx in targets:
        res = bf_calc.calculate_bf(
            stacks, prizes, hero_idx=hero_idx, villain_idx=v_idx, base_equities=equities
        )

        v_name = f"P_{v_idx:03d}"
        if v_idx == leader_idx:
            v_name += " (CL/チップリーダー)"
        else:
            v_name += " (指定相手)"

        v_stack_str = f"{res['villain_stack']:8,.0f} ({res['villain_stack']/model.bb_size:4.1f} BB)"
        eff_stack_str = f"{res['effective_stack']:8,.0f} ({res['effective_stack']/model.bb_size:4.1f} BB)"

        print(
            f"Player {v_name:<15} | {v_stack_str:<18} | {eff_stack_str:<16} | {res['cover_status']:<20} | {res['bubble_factor']:<8} | {res['min_win_rate_required']}"
        )

    # CSV出力
    TournamentDataExporter.export_to_csv(
        "de_icm_results.csv", stacks, equities, model.bb_size, hero_idx=hero_idx
    )