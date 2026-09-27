/**
 * The "This month" panel on the brand and creator dashboards: month to date,
 * scoped to the viewer, money from real orders. Built by
 * server/dashboardStats.ts; shared so the client reads the same shape.
 */
export interface MonthStats {
  /** ISO start of the period (first of the month, 00:00 UTC). */
  since: string;
  /** Currency of `revenue`. Orders in other currencies are counted, not summed. */
  currency: string;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  /** Clicks per view, as a percentage. 0 when there are no views. */
  ctr: number;
  /** Brand only: creators whose videos featuring the brand had activity. */
  activeCreators?: number;
  /** Revenue per UTC day from `since` to today inclusive, in `currency`. */
  revenueByDay: number[];
}
