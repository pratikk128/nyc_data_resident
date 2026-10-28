/*
 * Axis tick steps shared by the payroll charts, so axes read alike across
 * sections.
 */

// Smallest 1, 2, 2.5 or 5 × 10ⁿ step that fits max in about targetTicks ticks.
export function niceStep(max, targetTicks) {
  const raw = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}
