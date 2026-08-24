import { NextRequest } from "next/server";
import { exportAnalyticsCsv, type AnalyticsDimension, type AnalyticsQuery } from "@/lib/api";

const dimensions: readonly AnalyticsDimension[] = ["campaign", "icp", "channel", "role", "signal"];
const queryKeys: readonly (keyof AnalyticsQuery)[] = ["from", "to", "campaignId", "icpVersionId", "channel", "role", "signalType"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const search = request.nextUrl.searchParams;
  const options: AnalyticsQuery = Object.fromEntries(queryKeys.flatMap((key) => {
    const value = search.get(key);
    return value ? [[key, value]] : [];
  }));
  const rawDimension = search.get("dimension");
  const dimension = dimensions.find((candidate) => candidate === rawDimension);
  try {
    const csv = await exportAnalyticsCsv(workspaceSlug, options, dimension);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=analytics.csv" } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 500;
    return new Response("Impossible d’exporter les analytics", { status });
  }
}
