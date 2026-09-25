/**
 * EO-4.7 pipeline derivation — PURE and evidence-based. A step is completed
 * only when authoritative data proves it; missing evidence is `pending` or
 * `not_applicable`, never "done". PUSHED never implies DEPLOYED, DEPLOYED
 * never implies HEALTHY.
 */
import type { ProjectReleases, SessionDetail } from "../../../features/operations";

export type StepState = "completed" | "current" | "pending" | "blocked" | "failed" | "not_applicable";

export interface PipelineStep {
  key: "plan" | "prepare" | "execute" | "verify" | "review" | "approve" | "commit" | "push" | "deploy" | "verifyRelease";
  state: StepState;
}

export function derivePipeline(detail: SessionDetail, releases?: ProjectReleases): PipelineStep[] {
  const s = detail.session;
  const denied = s.status === "denied";
  const prepare: StepState = denied ? "blocked" : s.status === "created" || s.status === "validating" ? "current" : "completed";
  const execute: StepState =
    denied
      ? "not_applicable"
      : s.status === "running" || s.status === "cancelling"
        ? "current"
        : s.status === "succeeded"
          ? "completed"
          : s.status === "failed" || s.status === "timed_out"
            ? "failed"
            : s.status === "cancelled"
              ? "blocked"
              : "pending";
  const latest = [...detail.verifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const verify: StepState = !latest
    ? "pending"
    : latest.status === "passed"
      ? latest.sourceCurrent === false
        ? "blocked"
        : "completed"
      : latest.status === "running" || latest.status === "pending"
        ? "current"
        : latest.status === "blocked" || latest.status === "cancelled"
          ? "blocked"
          : "failed";

  const changeSetId = detail.changeSet?.changeSetId;
  const sc = releases?.sourceControl.configured ? releases.sourceControl : undefined;
  const deployments = releases?.deployments.configured ? releases.deployments : undefined;
  if (!sc) {
    const na: StepState = "not_applicable";
    return [
      { key: "plan", state: "completed" },
      { key: "prepare", state: prepare },
      { key: "execute", state: execute },
      { key: "verify", state: verify },
      { key: "review", state: na },
      { key: "approve", state: na },
      { key: "commit", state: na },
      { key: "push", state: na },
      { key: "deploy", state: na },
      { key: "verifyRelease", state: na },
    ];
  }
  const review = sc.reviews.find((r) => r.changeSetId === changeSetId);
  const commit = sc.commits.find((c) => c.changeSetId === changeSetId);
  const push = commit ? sc.pushes.find((p) => p.commitSha === commit.commitSha) : undefined;
  const release = commit
    ? deployments?.releases.filter((r) => r.commitSha === commit.commitSha).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    : undefined;
  const reviewState: StepState = !review ? "pending" : review.status === "approved" ? "completed" : review.status === "pending" ? "current" : "blocked";
  const deploy: StepState = !release
    ? push
      ? "pending"
      : "pending"
    : release.status === "failed"
      ? "failed"
      : release.status === "deploying"
        ? "current"
        : "completed";
  const verifyRelease: StepState = !release
    ? "pending"
    : release.status === "healthy"
      ? "completed"
      : release.status === "verifying"
        ? "current"
        : release.status === "degraded" || release.status === "failed"
          ? "failed"
          : release.status === "rolled_back"
            ? "blocked"
            : "pending";
  return [
    { key: "plan", state: "completed" },
    { key: "prepare", state: prepare },
    { key: "execute", state: execute },
    { key: "verify", state: verify },
    { key: "review", state: reviewState },
    // Approval is proven by the protected action it authorized.
    { key: "approve", state: commit ? "completed" : "pending" },
    { key: "commit", state: commit ? "completed" : "pending" },
    { key: "push", state: push ? "completed" : "pending" },
    { key: "deploy", state: deploy },
    { key: "verifyRelease", state: verifyRelease },
  ];
}
