/**
 * Firestore-backed `ExecutionJobQueue` (R2).
 *
 * Durable storage: one Firestore collection `execution_jobs` keyed by
 * `jobId`. Transactions are the only path that mutates job state so a
 * single worker owns the lease at all times.
 *
 * `acquire()` sweeps leases that have expired (worker crash) before
 * selecting the oldest `queued` job whose `availableAt` has arrived; the
 * selection + state transition + lease write all happen inside one
 * transaction.
 */
import { ValidationError, assertExecutionJobTransition, canTransitionExecutionJob, validateExecutionJob, } from "../../contracts/index.js";
export const EXECUTION_JOBS_COLLECTION = "execution_jobs";
function toJob(data) {
    return data;
}
export class FirestoreExecutionJobQueue {
    firestore;
    collection;
    clock;
    scanLimit;
    constructor(firestore, options = {}) {
        this.firestore = firestore;
        this.collection = firestore.collection((options.collectionPrefix ?? "") + EXECUTION_JOBS_COLLECTION);
        this.clock = options.clock ?? (() => new Date());
        this.scanLimit = options.scanLimit ?? 25;
    }
    async enqueue(input) {
        validateExecutionJob(input.job);
        const payload = this.serialize(input.job);
        const ref = this.collection.doc(input.job.jobId);
        await this.firestore.runTransaction(async (transaction) => {
            const existing = await transaction.get(ref);
            if (existing.exists) {
                // Idempotency: same job already enqueued. We treat this as a
                // no-op so an upstream retry does not create a duplicate.
                return;
            }
            transaction.create(ref, payload);
        });
    }
    async acquire(input) {
        const now = (input.now ?? this.clock()).toISOString();
        const expiresAt = new Date((input.now ?? this.clock()).getTime() + input.leaseTtlMs).toISOString();
        const scan = async () => {
            const snapshot = input.projectId
                ? await this.collection
                    .where("projectId", "==", input.projectId)
                    .get()
                : await this.collection.get();
            const result = [];
            for (const doc of snapshot.docs) {
                const data = doc.data();
                if (!data)
                    continue;
                result.push({ id: doc.id, job: toJob(data) });
            }
            return result;
        };
        // Pass 1 — sweep expired leases back to queued. We take a snapshot,
        // identify sweepable jobs, and run each sweep inside its own
        // transaction so a crashed worker's lease becomes re-claimable.
        const first = await scan();
        const sweepable = first.filter(({ job }) => (job.status === "leased" || job.status === "running") &&
            job.lease &&
            job.lease.expiresAt <= now);
        for (const { id } of sweepable) {
            await this.sweepExpired(id, now);
        }
        // Pass 2 — re-scan so swept jobs show up as queued, then try to
        // atomically claim the oldest eligible one.
        const second = sweepable.length > 0 ? await scan() : first;
        const claimable = second
            .filter(({ job }) => job.status === "queued" && (!job.availableAt || job.availableAt <= now))
            .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt))
            .slice(0, this.scanLimit);
        for (const { id } of claimable) {
            const claimed = await this.tryClaim(id, input.workerId, now, expiresAt);
            if (claimed)
                return claimed;
        }
        return undefined;
    }
    async heartbeat(input) {
        const now = (input.now ?? this.clock()).toISOString();
        const expiresAt = new Date((input.now ?? this.clock()).getTime() + input.extendLeaseByMs).toISOString();
        const ref = this.collection.doc(input.jobId);
        await this.firestore.runTransaction(async (transaction) => {
            const snap = await transaction.get(ref);
            if (!snap.exists)
                throw new ValidationError(`unknown job: ${input.jobId}`);
            const job = toJob(snap.data());
            if (!job.lease || job.lease.workerId !== input.workerId) {
                throw new ValidationError(`heartbeat denied: worker ${input.workerId} is not the owner of ${input.jobId}`);
            }
            if (job.status !== "leased" && job.status !== "running") {
                throw new ValidationError(`heartbeat denied: job ${input.jobId} is in terminal state ${job.status}`);
            }
            const nextLease = {
                ...job.lease,
                heartbeatAt: now,
                expiresAt,
            };
            transaction.set(ref, this.serialize({ ...job, lease: nextLease, updatedAt: now }));
        });
    }
    async complete(input) {
        const now = this.clock().toISOString();
        const ref = this.collection.doc(input.jobId);
        await this.firestore.runTransaction(async (transaction) => {
            const snap = await transaction.get(ref);
            if (!snap.exists)
                throw new ValidationError(`unknown job: ${input.jobId}`);
            const job = toJob(snap.data());
            if (!job.lease || job.lease.workerId !== input.workerId) {
                throw new ValidationError(`complete denied: worker ${input.workerId} does not own ${input.jobId}`);
            }
            if (job.status === input.status && job.lease.workerId === input.workerId) {
                // Idempotent completion.
                return;
            }
            // Requeue path (transient failure): go back to queued, incrementing
            // attempt if the caller asked for it, and clear the lease.
            if (input.requeue && input.status === "failed") {
                if (!canTransitionExecutionJob(job.status, "queued")) {
                    throw new ValidationError(`cannot requeue job in state ${job.status}`);
                }
                const next = {
                    ...job,
                    status: "queued",
                    availableAt: input.requeue.availableAt,
                    attempt: input.requeue.incrementAttempt
                        ? job.attempt + 1
                        : job.attempt,
                    updatedAt: now,
                    lastError: input.lastError,
                };
                const serialized = this.serialize(next);
                delete serialized.lease;
                transaction.set(ref, serialized);
                return;
            }
            assertExecutionJobTransition(job.status, input.status);
            transaction.set(ref, this.serialize({
                ...job,
                status: input.status,
                updatedAt: now,
                completedAt: now,
                executionReceiptId: input.executionReceiptId,
                lastError: input.lastError,
            }));
        });
    }
    async requestCancellation(jobId, reason) {
        const now = this.clock().toISOString();
        const ref = this.collection.doc(jobId);
        await this.firestore.runTransaction(async (transaction) => {
            const snap = await transaction.get(ref);
            if (!snap.exists)
                throw new ValidationError(`unknown job: ${jobId}`);
            const job = toJob(snap.data());
            if (job.status === "succeeded" ||
                job.status === "failed" ||
                job.status === "cancelled" ||
                job.status === "dead_letter") {
                return;
            }
            transaction.set(ref, this.serialize({
                ...job,
                cancellationRequested: true,
                cancellationReason: reason,
                updatedAt: now,
            }));
        });
    }
    async get(jobId) {
        const snap = await this.collection.doc(jobId).get();
        if (!snap.exists)
            return undefined;
        return toJob(snap.data());
    }
    async findByIdempotencyKey(key) {
        const snapshot = await this.collection
            .where("idempotencyKey", "==", key)
            .get();
        if (snapshot.docs.length === 0)
            return undefined;
        return toJob(snapshot.docs[0].data());
    }
    async tryClaim(jobId, workerId, now, expiresAt) {
        const ref = this.collection.doc(jobId);
        try {
            return await this.firestore.runTransaction(async (transaction) => {
                const snap = await transaction.get(ref);
                if (!snap.exists)
                    return undefined;
                const job = toJob(snap.data());
                if (job.status !== "queued")
                    return undefined;
                if (job.availableAt > now)
                    return undefined;
                if (!canTransitionExecutionJob(job.status, "leased")) {
                    return undefined;
                }
                const lease = {
                    leaseId: `lease_${jobId}_${now}`,
                    workerId,
                    acquiredAt: now,
                    expiresAt,
                    heartbeatAt: now,
                };
                const next = {
                    ...job,
                    status: "leased",
                    lease,
                    updatedAt: now,
                };
                transaction.set(ref, this.serialize(next));
                return next;
            });
        }
        catch {
            return undefined;
        }
    }
    async sweepExpired(jobId, now) {
        const ref = this.collection.doc(jobId);
        try {
            await this.firestore.runTransaction(async (transaction) => {
                const snap = await transaction.get(ref);
                if (!snap.exists)
                    return;
                const job = toJob(snap.data());
                if ((job.status !== "leased" && job.status !== "running") ||
                    !job.lease ||
                    job.lease.expiresAt > now) {
                    return;
                }
                if (!canTransitionExecutionJob(job.status, "queued"))
                    return;
                const next = {
                    ...job,
                    status: "queued",
                    attempt: job.attempt + 1,
                    availableAt: now,
                    updatedAt: now,
                    lastError: {
                        code: "lease_expired",
                        message: `worker ${job.lease.workerId} lost its lease (expired at ${job.lease.expiresAt})`,
                        retryable: true,
                        recordedAt: now,
                    },
                };
                const serialized = this.serialize(next);
                delete serialized.lease;
                transaction.set(ref, serialized);
            });
        }
        catch {
            // Sweep failures are best-effort; the next acquire tries again.
        }
    }
    serialize(job) {
        return JSON.parse(JSON.stringify(job));
    }
}
