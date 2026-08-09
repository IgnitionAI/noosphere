export const ANALYTICS_DIMENSIONS = ["campaign", "icp", "channel", "role", "signal"] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export interface AnalyticsFilters {
  readonly workspaceId: string;
  readonly from: Date;
  readonly to: Date;
  readonly campaignId?: string;
  readonly icpVersionId?: string;
  readonly channel?: string;
  readonly signalType?: string;
  readonly role?: string;
}

export interface FunnelMetrics {
  readonly prospectsFound: number;
  readonly profilesEnriched: number;
  readonly actionsPlanned: number;
  readonly attempts: number;
  readonly actionsSent: number;
  readonly actionsAccepted: number;
  readonly responded: number;
  readonly positiveReplies: number;
  readonly meetingsBooked: number;
  readonly opportunities: number;
  readonly revenue: number;
}

export interface AnalyticsFunnel {
  readonly period: { readonly from: Date; readonly to: Date };
  readonly metrics: FunnelMetrics;
}

export interface AnalyticsBreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly prospectsFound: number | null;
  readonly profilesEnriched: number | null;
  readonly actionsPlanned: number;
  readonly attempts: number;
  readonly actionsSent: number;
  readonly actionsAccepted: number;
  readonly responded: number;
  readonly positiveReplies: number | null;
  readonly meetingsBooked: number | null;
  readonly opportunities: number | null;
  readonly revenue: number | null;
}

export interface AnalyticsCosts {
  readonly totalAiCost: number;
  readonly costPerProspect: number;
  readonly costPerMeeting: number;
}
