import { linkedinContentFormats, type LinkedinContentFormat } from "@outbound/domain/content/content-brand-kit";

export interface ContentFormatPerformance {
  readonly format: LinkedinContentFormat;
  readonly publications: number;
  readonly impressions: number;
  readonly reactions: number;
  readonly comments: number;
  readonly reposts: number;
  readonly engagementRate: number | null;
}

export interface ContentPerformanceView {
  readonly formats: readonly ContentFormatPerformance[];
  readonly observedAt: Date;
}

export interface ContentPerformanceRepository {
  read(workspaceId: string): Promise<ContentPerformanceView>;
}

export class ContentPerformanceApplication {
  constructor(private readonly repository: ContentPerformanceRepository) {}
  get(workspaceId: string): Promise<ContentPerformanceView> { return this.repository.read(workspaceId); }
}

export function completeFormatPerformance(rows: readonly ContentFormatPerformance[]): readonly ContentFormatPerformance[] {
  const byFormat = new Map(rows.map((row) => [row.format, row]));
  return linkedinContentFormats.map((format) => byFormat.get(format) ?? {
    format,
    publications: 0,
    impressions: 0,
    reactions: 0,
    comments: 0,
    reposts: 0,
    engagementRate: null,
  });
}
