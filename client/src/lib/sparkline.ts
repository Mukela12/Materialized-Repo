/**
 * A trend line is only drawn when there is a trend to show. One sale on one
 * day, or a month of zeros, drawn as a line is decoration pretending to be
 * data, which is the thing the dashboard redesign set out to remove.
 */
export function hasTrend(values: readonly number[] | undefined): boolean {
  if (!values || values.length < 3) return false;
  return values.filter((v) => v > 0).length >= 2;
}

/**
 * SVG path data for a line through `values`, scaled to a w x h box with the
 * baseline at the bottom. Returns the line and the closed area under it.
 */
export function sparkPaths(values: readonly number[], w: number, h: number, pad = 2): { line: string; area: string } {
  const max = Math.max(...values, 0);
  const n = values.length;
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => (max === 0 ? h - pad : h - pad - (v / max) * (h - pad * 2));
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(n - 1).toFixed(2)},${h} L${x(0).toFixed(2)},${h} Z`;
  return { line, area };
}

/**
 * Running total. A month-to-date figure is drawn as it accumulated (the way
 * Stripe draws gross volume): sparse daily sales plotted raw are a row of
 * spikes that says less than the curve of the total climbing.
 */
export function cumulative(values: readonly number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v));
}
