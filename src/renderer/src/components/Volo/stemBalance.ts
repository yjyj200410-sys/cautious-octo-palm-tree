/** Centre reconstructs the original mix; each end removes exactly one stem. */
export function stemBalanceMix(value: number) {
  const balance = Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0;
  return {
    vocals: balance > 0 ? 100 - balance : 100,
    accompaniment: balance < 0 ? 100 + balance : 100
  };
}

export function mixToStemBalance(vocals: number, accompaniment: number) {
  const peak = Math.max(vocals, accompaniment);
  return peak > 0 ? Math.round(((accompaniment - vocals) / peak) * 100) : 0;
}
