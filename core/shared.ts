let sequence = 0;
export const now = (): string => new Date().toISOString();
export const createId = (prefix: string): string => `${prefix}_${++sequence}`;
