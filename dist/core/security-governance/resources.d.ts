/**
 * Resource, environment and data classification — deterministic and pure.
 *
 * A resource reference is a string: a bare path or `file:<path>` for project
 * files, otherwise `<kind>:<name>` (`secret:API_KEY`, `firebase-project:prod`,
 * `deploy:production`, `branch:main`, `database:prod/users`, `repo:acme/aims`).
 */
import { type ActionClass, type DataClass, type GovEnvironment, type ResourceInfo, type ResourceKind } from "../../contracts/security-governance.js";
export declare function describeResource(ref: string, envHint?: GovEnvironment): ResourceInfo;
/** Does the text carry a credential? Classifies the data accordingly. */
export declare function classifyContent(content: string | undefined, floor?: DataClass): DataClass;
export declare const dataClassRank: (c: DataClass) => number;
export declare const maxDataClass: (a: DataClass, b: DataClass) => DataClass;
/** Environment mentioned in free text; `undefined` when nothing is said. */
export declare function inferEnvironment(text: string): GovEnvironment | undefined;
/** Map a Layer 5 tool operation to an action class. */
export declare function actionForOperation(operation: string): ActionClass;
export declare const SENSITIVE_KINDS: readonly ResourceKind[];
