export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export interface ContentHasher {
  hash(value: unknown): Promise<string>;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}
