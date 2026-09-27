import { Checkbox, Input, Select, Textarea } from "../../../components/ui";
import { PROJECT_PRIORITIES, type OnboardingIdentity, type OnboardingKind, type OnboardingSource, type SourceProviderStatus } from "../types";
import type { FieldErrors } from "../lib/validation";
import { normalizeCode, suggestCode } from "../lib/validation";
import { useT } from "../lib/useT";
import { Notice } from "./common";

import { FIELD_IDS } from "../lib/fieldIds";

interface IdentityProps {
  value: Partial<OnboardingIdentity>;
  errors: FieldErrors;
  disabled?: boolean;
  /** Track whether the operator typed their own code, so the suggestion stops overwriting it. */
  codeTouched: boolean;
  onCodeTouched: () => void;
  onChange: (next: Partial<OnboardingIdentity>) => void;
  /** Auto setup shows only the minimal fields. */
  minimal?: boolean;
}

export function IdentityFields({ value, errors, disabled, codeTouched, onCodeTouched, onChange, minimal }: IdentityProps) {
  const { tt } = useT();
  const err = (key: keyof FieldErrors) => (errors[key] ? tt(`validation.${errors[key]}`) : undefined);
  return (
    <div className="ob-form-grid">
      <Input
        id={FIELD_IDS.name}
        label={tt("identity.name")}
        value={value.name ?? ""}
        disabled={disabled}
        required
        autoComplete="off"
        error={err("name")}
        onChange={(e) => {
          const name = e.target.value;
          onChange({ ...value, name, ...(codeTouched ? {} : { code: suggestCode(name) }) });
        }}
      />
      <Input
        id={FIELD_IDS.code}
        label={tt("identity.code")}
        description={tt("identity.codeHelp")}
        value={value.code ?? ""}
        disabled={disabled}
        required
        maxLength={12}
        autoComplete="off"
        error={err("code")}
        onChange={(e) => {
          onCodeTouched();
          onChange({ ...value, code: normalizeCode(e.target.value) });
        }}
      />
      {minimal ? null : (
        <>
          <Input
            label={tt("identity.fullName")}
            value={value.fullName ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, fullName: e.target.value })}
          />
          <Input
            label={tt("identity.applicationType")}
            description={tt("identity.applicationTypeHelp")}
            value={value.applicationType ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, applicationType: e.target.value })}
          />
          <Select
            label={tt("identity.priority")}
            value={value.priority ?? "normal"}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, priority: e.target.value as OnboardingIdentity["priority"] })}
          >
            {PROJECT_PRIORITIES.map((p) => (
              <option key={p} value={p}>{tt(`priority.${p}`)}</option>
            ))}
          </Select>
          <Input
            label={tt("identity.owner")}
            description={tt("identity.ownerHelp")}
            value={value.owner ?? ""}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => onChange({ ...value, owner: e.target.value })}
          />
          <div className="ob-form-grid__wide">
            <Textarea
              label={tt("identity.description")}
              rows={3}
              value={value.description ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
            />
          </div>
        </>
      )}
      <div className="ob-form-grid__wide">
        <Textarea
          id={FIELD_IDS.objective}
          label={tt("identity.objective")}
          description={tt("identity.objectiveHelp")}
          rows={3}
          value={value.objective ?? ""}
          disabled={disabled}
          error={err("objective")}
          onChange={(e) => onChange({ ...value, objective: e.target.value })}
        />
      </div>
    </div>
  );
}

interface SourceProps {
  kind: OnboardingKind;
  value: Partial<OnboardingSource>;
  errors: FieldErrors;
  disabled?: boolean;
  providers?: SourceProviderStatus[];
  gapNote?: string;
  onChange: (next: Partial<OnboardingSource>) => void;
}

export function SourceFields({ kind, value, errors, disabled, providers, gapNote, onChange }: SourceProps) {
  const { tt } = useT();
  const err = (key: keyof FieldErrors) => (errors[key] ? tt(`validation.${errors[key]}`) : undefined);
  if (kind === "import_local") {
    return <Notice tone="warning">{tt("source.localUnavailable")}</Notice>;
  }
  if (kind === "import_existing") {
    const github = providers?.find((p) => p.provider === "github");
    return (
      <div className="ob-form-grid">
        <div className="ob-form-grid__wide">
          <Input
            id={FIELD_IDS.repositoryUrl}
            type="url"
            inputMode="url"
            label={tt("source.repositoryUrl")}
            description={tt("source.repositoryUrlHelp")}
            placeholder="https://github.com/owner/repository"
            value={value.repositoryUrl ?? ""}
            disabled={disabled}
            required
            autoComplete="off"
            spellCheck={false}
            error={err("repositoryUrl")}
            onChange={(e) => onChange({ ...value, provider: value.provider ?? "github", repositoryUrl: e.target.value })}
          />
        </div>
        <Input
          label={tt("source.branch")}
          description={tt("source.branchHelp")}
          value={value.branch ?? ""}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange({ ...value, branch: e.target.value })}
        />
        <div className="ob-form-grid__wide">
          <Notice>
            {tt("source.privateRepoNote")}
            {github?.note ? <> {github.note}</> : null}
          </Notice>
        </div>
      </div>
    );
  }
  return (
    <div className="ob-form-grid">
      <div className="ob-form-grid__wide">
        <Textarea
          id={FIELD_IDS.specification}
          label={tt("source.specification")}
          description={tt("source.specificationHelp")}
          rows={8}
          value={value.specification ?? ""}
          disabled={disabled}
          required
          error={err("specification")}
          onChange={(e) => onChange({ ...value, provider: value.provider ?? "template", specification: e.target.value })}
        />
      </div>
      <div className="ob-form-grid__wide">
        <Checkbox
          label={tt("source.createRepository")}
          description={tt("source.createRepositoryHelp")}
          checked={value.createRepository === true}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, createRepository: e.target.checked })}
        />
        {value.createRepository ? <Notice tone="warning">{gapNote ?? tt("source.createRepositoryGap")}</Notice> : null}
      </div>
    </div>
  );
}
