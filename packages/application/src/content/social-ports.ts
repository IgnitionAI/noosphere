export type SocialNetwork = "linkedin";

export interface SocialPublisherCapabilities {
  readonly network: SocialNetwork;
  readonly accountId: string;
  readonly accountHealthy: boolean;
  readonly textPublishing: "available" | "unavailable";
  readonly observedAt: Date;
}

export interface SocialPublishTextRequest {
  readonly accountId: string;
  readonly text: string;
  readonly requestKey: string;
}

export interface SocialPublishResult {
  readonly providerPostId: string;
  readonly socialId: string | null;
  readonly url: string | null;
  readonly publishedAt: Date | null;
}

export interface SocialPublisher {
  observeCapabilities(input: {
    readonly accountId: string;
    readonly now?: Date;
  }): Promise<SocialPublisherCapabilities>;
  publishText(input: SocialPublishTextRequest): Promise<SocialPublishResult>;
}

export interface SocialContentSnapshot {
  readonly providerPostId: string;
  readonly socialId: string | null;
  readonly authorProviderId: string | null;
  readonly text: string;
  readonly url: string | null;
  readonly publishedAt: Date | null;
  readonly observedAt: Date;
}

export interface SocialContentReader {
  listOwnContent(input: {
    readonly accountId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<{
    readonly data: readonly SocialContentSnapshot[];
    readonly nextCursor: string | null;
  }>;
}

export interface SocialMetricsSnapshot {
  readonly providerPostId: string;
  readonly impressions: number | null;
  readonly reactions: number | null;
  readonly comments: number | null;
  readonly reposts: number | null;
  readonly observedAt: Date;
}

export interface SocialMetricsReader {
  readMetrics(input: {
    readonly accountId: string;
    readonly providerPostIds: readonly string[];
  }): Promise<readonly SocialMetricsSnapshot[]>;
}

export type SocialProviderErrorCode =
  | "SOCIAL_REQUEST_INVALID"
  | "SOCIAL_ACCOUNT_UNAVAILABLE"
  | "SOCIAL_AUTHENTICATION_FAILED"
  | "SOCIAL_CONTENT_REJECTED"
  | "SOCIAL_RATE_LIMITED"
  | "SOCIAL_PROVIDER_UNAVAILABLE"
  | "SOCIAL_PROVIDER_RESPONSE_INVALID";

export class SocialProviderError extends Error {
  constructor(
    readonly code: SocialProviderErrorCode,
    message: string,
    readonly deliveryState: "not_sent" | "unknown",
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "SocialProviderError";
  }
}
