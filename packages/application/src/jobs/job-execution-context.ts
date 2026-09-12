export interface JobExecutionContext {
  run<T>(job: { readonly id: string; readonly workspaceId: string }, execute: () => Promise<T>): Promise<T>;
}
