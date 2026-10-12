/** Minimal semantic-version helpers (no dependency): x.y.z with ^ ~ >= > <= < = * ranges. */
export interface SemVer {
    major: number;
    minor: number;
    patch: number;
}
export declare function parseVersion(v: string): SemVer | undefined;
export declare function compareVersions(a: string, b: string): number;
export declare function satisfies(version: string, range: string | undefined): boolean;
export declare function isValidRange(range: string | undefined): boolean;
