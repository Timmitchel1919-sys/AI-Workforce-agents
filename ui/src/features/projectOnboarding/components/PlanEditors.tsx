import { useState } from "react";
import { Button, Checkbox, Input, Select } from "../../../components/ui";
import {
  AUTONOMY_LEVELS,
  type AutonomyLevel,
  type CostPolicy,
  type GitPolicy,
  type OnboardingOverride,
  type OnboardingSession,
} from "../types";
import type { OnboardingPatch } from "../api/onboardingClient";
import { useT } from "../lib/useT";
import { Notice } from "./common";
import { OverrideList } from "./PlanViews";

interface EditorProps {
  session: OnboardingSession;
  disabled: boolean;
  busy: boolean;
  onPatch: (patch: OnboardingPatch) => Promise<unknown>;
}

const OVERRIDE_FIELDS = ["language", "framework", "packageManager", "buildSystem", "testSystem", "deploymentTarget"] as const;

function recommendedFor(session: OnboardingSession, field: string): string | undefined {
  const tech = session.plan?.technology;
  if (!tech) return undefined;
  const map: Record<string, { value: string }[]> = {
    language: tech.languages,
    framework: tech.frameworks,
    packageManager: tech.packageManagers,
    buildSystem: tech.buildSystems,
    testSystem: tech.testSystems,
    deploymentTarget: tech.deploymentTargets,
  };
  return map[field]?.[0]?.value;
}

/** A deliberate divergence is recorded (and audited) as an override, never silently applied. */
export function OverridesEditor({ session, disabled, busy, onPatch }: EditorProps) {
  const { tt } = useT();
  const [field, setField] = useState<string>(OVERRIDE_FIELDS[0]);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const current = session.draft.overrides;

  const add = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const recommended = recommendedFor(session, field);
    const next: OnboardingOverride = {
      field,
      value: trimmed,
      ...(recommended ? { recommended } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    await onPatch({ overrides: [...current.filter((o) => o.field !== field), next] });
    setValue("");
    setReason("");
  };

  return (
    <div className="ob-stack">
      <h4 className="ob-subtitle">{tt("tech.overrides")}</h4>
      <p className="ob-muted">{tt("tech.overridesHelp")}</p>
      {current.length === 0 ? <p className="ob-muted">{tt("tech.noOverrides")}</p> : <OverrideList overrides={current} />}
      {current.map((o) => (
        <Button
          key={o.field}
          type="button"
          size="small"
          disabled={disabled || busy}
          onClick={() => void onPatch({ overrides: current.filter((c) => c.field !== o.field) })}
        >
          {tt("tech.removeOverride", { field: o.field })}
        </Button>
      ))}
      <div className="ob-form-grid">
        <Select label={tt("tech.overrideField")} value={field} disabled={disabled} onChange={(e) => setField(e.target.value)}>
          {OVERRIDE_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Input label={tt("tech.overrideValue")} value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} />
        <div className="ob-form-grid__wide">
          <Input label={tt("tech.overrideReason")} value={reason} disabled={disabled} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <p className="ob-muted">{tt("tech.recommended")}: {recommendedFor(session, field) ?? tt("common.notEstablished")}</p>
      <div className="ob-actions">
        <Button type="button" disabled={disabled || busy || value.trim() === ""} loading={busy} onClick={() => void add()}>
          {tt("tech.addOverride")}
        </Button>
      </div>
    </div>
  );
}

/** Capabilities are authoritative; a level only selects a preset and is never a bypass. */
export function AutonomyEditor({ session, disabled, busy, onPatch }: EditorProps) {
  const { tt } = useT();
  const [level, setLevel] = useState<AutonomyLevel>(session.draft.autonomyLevel);
  const dirty = level !== session.draft.autonomyLevel;
  return (
    <div className="ob-stack">
      <Notice>{tt("permissions.authoritative")}</Notice>
      <fieldset className="ob-fieldset" disabled={disabled}>
        <legend>{tt("permissions.levelLegend")}</legend>
        {AUTONOMY_LEVELS.map((l) => (
          <label key={l} className="ob-radio">
            <input type="radio" name="autonomy-level" value={l} checked={level === l} onChange={() => setLevel(l)} />
            <span>
              <span className="ob-strong">{l} - {tt(`permissions.level${l}.name`)}</span>
              <span className="ob-muted ob-block">{tt(`permissions.level${l}.description`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="ob-actions">
        <Button type="button" disabled={disabled || busy || !dirty} loading={busy} onClick={() => void onPatch({ autonomyLevel: level })}>
          {tt("common.saveChanges")}
        </Button>
      </div>
    </div>
  );
}

const GIT_BOOLEANS = [
  "testsRequired",
  "reviewRequired",
  "securityCheckRequired",
  "autoCommit",
  "autoPush",
  "pullRequestRequired",
  "allowDirectDefaultBranchWrites",
] as const;

export function GitEditor({ session, disabled, busy, onPatch }: EditorProps) {
  const { tt } = useT();
  const base = (session.plan?.git ?? {}) as Partial<GitPolicy>;
  const [git, setGit] = useState<Partial<GitPolicy>>({ ...base, ...session.draft.gitPolicy });
  return (
    <div className="ob-stack">
      <h4 className="ob-subtitle">{tt("git.edit")}</h4>
      <div className="ob-form-grid">
        <Input label={tt("git.defaultBranch")} value={git.defaultBranch ?? ""} disabled={disabled}
          onChange={(e) => setGit({ ...git, defaultBranch: e.target.value })} />
        <Input label={tt("git.developmentBranch")} value={git.developmentBranch ?? ""} disabled={disabled}
          onChange={(e) => setGit({ ...git, developmentBranch: e.target.value })} />
        <Input label={tt("git.agentBranchPattern")} value={git.agentBranchPattern ?? ""} disabled={disabled}
          onChange={(e) => setGit({ ...git, agentBranchPattern: e.target.value })} />
        <Select label={tt("git.mergePolicy")} value={git.mergePolicy ?? "manual"} disabled={disabled}
          onChange={(e) => setGit({ ...git, mergePolicy: e.target.value as GitPolicy["mergePolicy"] })}>
          <option value="manual">{tt("git.mergeManual")}</option>
          <option value="approved_only">{tt("git.mergeApprovedOnly")}</option>
        </Select>
        {GIT_BOOLEANS.map((key) => (
          <Checkbox key={key} label={tt(`git.${key}`)} checked={git[key] === true} disabled={disabled}
            onChange={(e) => setGit({ ...git, [key]: e.target.checked })} />
        ))}
      </div>
      {git.allowDirectDefaultBranchWrites ? <Notice tone="warning">{tt("git.directWritesWarning")}</Notice> : null}
      <div className="ob-actions">
        <Button type="button" disabled={disabled || busy} loading={busy} onClick={() => void onPatch({ gitPolicy: git })}>
          {tt("common.saveChanges")}
        </Button>
      </div>
    </div>
  );
}

function toNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Budget numbers are optional; recording a policy is not enforcing it. */
export function CostEditor({ session, disabled, busy, onPatch }: EditorProps) {
  const { tt } = useT();
  const base = session.plan?.cost;
  const draft = session.draft.costPolicy;
  const [daily, setDaily] = useState(String(draft?.dailyLimit ?? base?.dailyLimit ?? ""));
  const [monthly, setMonthly] = useState(String(draft?.monthlyLimit ?? base?.monthlyLimit ?? ""));
  const [task, setTask] = useState(String(draft?.taskLimit ?? base?.taskLimit ?? ""));
  const [threshold, setThreshold] = useState(String(draft?.warningThresholdPercent ?? base?.warningThresholdPercent ?? 80));
  const [hardStop, setHardStop] = useState(draft?.hardStop ?? base?.hardStop ?? false);
  const thresholdNumber = Number(threshold);
  const thresholdValid = Number.isFinite(thresholdNumber) && thresholdNumber >= 1 && thresholdNumber <= 100;

  const save = () => {
    const patch: Partial<CostPolicy> = { warningThresholdPercent: thresholdNumber, hardStop };
    const d = toNumber(daily);
    const m = toNumber(monthly);
    const t = toNumber(task);
    if (d !== undefined) patch.dailyLimit = d;
    if (m !== undefined) patch.monthlyLimit = m;
    if (t !== undefined) patch.taskLimit = t;
    void onPatch({ costPolicy: patch });
  };

  return (
    <div className="ob-stack">
      <div className="ob-form-grid">
        <Input label={tt("budget.daily")} type="number" min={0} inputMode="decimal" value={daily} disabled={disabled} onChange={(e) => setDaily(e.target.value)} />
        <Input label={tt("budget.monthly")} type="number" min={0} inputMode="decimal" value={monthly} disabled={disabled} onChange={(e) => setMonthly(e.target.value)} />
        <Input label={tt("budget.task")} type="number" min={0} inputMode="decimal" value={task} disabled={disabled} onChange={(e) => setTask(e.target.value)} />
        <Input label={tt("budget.warningThreshold")} type="number" min={1} max={100} value={threshold} disabled={disabled}
          error={thresholdValid ? undefined : tt("budget.thresholdInvalid")} onChange={(e) => setThreshold(e.target.value)} />
        <Checkbox label={tt("budget.hardStop")} checked={hardStop} disabled={disabled} onChange={(e) => setHardStop(e.target.checked)} />
      </div>
      <p className="ob-muted">{tt("budget.optionalNote")}</p>
      <div className="ob-actions">
        <Button type="button" disabled={disabled || busy || !thresholdValid} loading={busy} onClick={save}>
          {tt("common.saveChanges")}
        </Button>
      </div>
    </div>
  );
}
