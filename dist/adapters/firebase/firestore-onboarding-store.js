/**
 * Firestore stores for project onboarding (PROJECT-2).
 *
 *   onboarding_sessions/{id}        the onboarding record (revision-CAS)
 *   provisioned_projects/{id}       the provisioned project record
 *   project_claims/{code|repo key}  unique claims: project code, repository
 *
 * Every mutation is a transaction: the session revision must still match,
 * and a project's id / code / repository claims are taken atomically with its
 * record, so two concurrent provisioning runs cannot both create a project.
 * Only the Control Plane (Admin SDK) writes here; client rules stay deny-all.
 */
import { createHash } from "node:crypto";
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}
export class FirestoreOnboardingSessionStore {
    firestore;
    col;
    constructor(firestore, options = {}) {
        this.firestore = firestore;
        this.col = firestore.collection((options.collectionPrefix ?? "") + "onboarding_sessions");
    }
    async get(id) {
        const snap = await this.col.doc(id).get();
        return snap.exists
            ? structuredClone(snap.data())
            : undefined;
    }
    async list() {
        const snap = await this.col.get();
        return snap.docs.map((d) => structuredClone(d.data()));
    }
    async create(session) {
        const ref = this.col.doc(session.id);
        return this.firestore.runTransaction(async (tx) => {
            if ((await tx.get(ref)).exists)
                return false;
            tx.create(ref, plain(session));
            return true;
        });
    }
    async replace(session, expectedRevision) {
        const ref = this.col.doc(session.id);
        return this.firestore.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const current = snap.exists
                ? snap.data()
                : undefined;
            if (!current || current.revision !== expectedRevision)
                return false;
            tx.set(ref, plain(session));
            return true;
        });
    }
}
export class FirestoreProvisionedProjectStore {
    firestore;
    projects;
    claims;
    constructor(firestore, options = {}) {
        this.firestore = firestore;
        const prefix = options.collectionPrefix ?? "";
        this.projects = firestore.collection(prefix + "provisioned_projects");
        this.claims = firestore.collection(prefix + "project_claims");
    }
    async get(id) {
        const snap = await this.projects.doc(id).get();
        return snap.exists
            ? structuredClone(snap.data())
            : undefined;
    }
    async list() {
        const snap = await this.projects.get();
        return snap.docs.map((d) => structuredClone(d.data()));
    }
    async create(project) {
        const ref = this.projects.doc(project.id);
        const codeRef = this.claims.doc(claimId("code", project.code));
        const repoRef = project.repositoryKey !== undefined
            ? this.claims.doc(claimId("repo", project.repositoryKey))
            : undefined;
        return this.firestore.runTransaction(async (tx) => {
            const existing = await tx.get(ref);
            const codeClaim = await tx.get(codeRef);
            const repoClaim = repoRef ? await tx.get(repoRef) : undefined;
            if (existing.exists) {
                const data = existing.data();
                return {
                    result: "exists",
                    sameOnboarding: data.onboardingId === project.onboardingId,
                };
            }
            if (codeClaim.exists)
                return { result: "conflict", reason: "code" };
            if (repoClaim?.exists)
                return { result: "conflict", reason: "repository" };
            tx.create(ref, plain(project));
            tx.create(codeRef, { projectId: project.id });
            if (repoRef)
                tx.create(repoRef, { projectId: project.id });
            return { result: "created" };
        });
    }
    async replace(project, expectedRevision) {
        const ref = this.projects.doc(project.id);
        return this.firestore.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const current = snap.exists
                ? snap.data()
                : undefined;
            if (!current || current.revision !== expectedRevision)
                return false;
            tx.set(ref, plain(project));
            return true;
        });
    }
}
function claimId(kind, value) {
    return `${kind}-${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}
