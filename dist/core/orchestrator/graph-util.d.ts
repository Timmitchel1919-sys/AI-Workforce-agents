/**
 * Leaf helpers shared by the projection engine and its fragment builders.
 * This module imports nothing from the graph modules, so there is no cycle.
 */
export declare function redactSecrets(value: string): string;
export declare function truncate(value: string, max: number): string;
/** Only display-safe scalar metadata survives; undefined entries are dropped. */
export declare function safeMetadata(input: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> | undefined;
export declare function joinList(values: readonly string[] | undefined): string | undefined;
export declare const byId: <T extends {
    id: string;
}>(a: T, b: T) => number;
