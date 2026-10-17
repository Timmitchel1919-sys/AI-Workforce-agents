export async function runOnce(options) {
    const leaseTtlMs = options.leaseTtlMs ?? 60_000;
    const job = await options.queue.acquire({
        workerId: options.workerId,
        leaseTtlMs,
        projectId: options.projectId,
    });
    if (!job)
        return undefined;
    const controller = new AbortController();
    const result = await options.dispatcher.dispatch(job, controller.signal);
    const terminal = mapResultStatus(result.status);
    await options.queue.complete({
        jobId: job.jobId,
        workerId: options.workerId,
        status: terminal,
        lastError: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                retryable: result.error.retryable,
                recordedAt: new Date().toISOString(),
            }
            : undefined,
    });
    options.onCompleted?.(job, result);
    return job;
}
export async function runWorkerLoop(options, shutdown) {
    const idle = options.idlePollMs ?? 2_000;
    const sleep = options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    while (!shutdown.aborted) {
        const job = await runOnce(options);
        if (!job) {
            await sleep(idle);
        }
    }
}
function mapResultStatus(status) {
    switch (status) {
        case "succeeded":
            return "succeeded";
        case "cancelled":
            return "cancelled";
        case "timed_out":
        case "failed":
        default:
            return "failed";
    }
}
