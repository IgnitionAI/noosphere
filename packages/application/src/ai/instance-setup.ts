export interface InstanceSetupRepository {
  isAdministrator(userId: string): Promise<boolean>;
  getState(): Promise<{ skipped: boolean }>;
  skip(): Promise<void>;
}

export class InstancePermissionError extends Error {}

export class InstanceSetupApplication {
  constructor(private readonly repository: InstanceSetupRepository, private readonly isAiReady?: () => Promise<boolean>) {}
  async get(userId: string) {
    const [isAdministrator, state] = await Promise.all([
      this.repository.isAdministrator(userId), this.repository.getState(),
    ]);
    return { isAdministrator, skipped: state.skipped, ...(this.isAiReady ? { aiReady: await this.isAiReady() } : {}) };
  }
  async skip(userId: string) {
    if (!await this.repository.isAdministrator(userId)) throw new InstancePermissionError();
    await this.repository.skip();
    return this.get(userId);
  }
}
