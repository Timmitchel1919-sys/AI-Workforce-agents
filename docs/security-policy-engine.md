# Security Policy Engine

## Overview
The Security Policy Engine is a deterministic enforcement layer that sits immediately after RBAC capability and project scope checks. It evaluates whether an explicitly authorized action complies with the overarching security and risk policies of the private software factory.

Unlike RBAC (which answers "Does this identity hold the capability to perform this action in this project?"), the Security Policy Engine answers "Is this action fundamentally safe to perform right now, or does it require elevated governance (like approval, MFA, or reauthentication) due to its inherent risk?".

## Decision Flow
1. **Authenticated Identity**: Operator's identity is verified.
2. **Active Account**: Operator account status is checked.
3. **RBAC Check**: `operatorCan` capability validation.
4. **Project Scope Check**: Validation that the operator can act within the target project context.
5. **Security Policy Engine**:
   - Matches action against defined security policies (`core/security/security-policy-engine.ts`).
   - Assesses the risk level.
   - Enforces system invariants (e.g., audit log deletion is unconditionally denied).
6. **Execute or Deny**: Rejects requests that are explicitly denied or enforces approval workflows if required.
7. **Audit**: Irrespective of outcome, decisions are recorded securely as `security_policy_decision` events.

## Risk Levels
The Engine classifies actions into four risk levels:
- **Low**: Normal read operations (e.g., `view`, `list_tasks`). No explicit approval needed.
- **Medium**: Standard operational mutations (e.g., `retry_task`, `disable_agent`). No explicit approval needed.
- **High**: Privileged access modifications, security policy changes, or destructive actions outside of production. Requires explicit approval.
- **Critical**: Raw secret access, audit log modifications, or production destructive actions. Often explicitly denied or requires extreme multi-factor authorization.

## Invariants
To prevent self-bypass and preserve non-repudiation, the Engine hardcodes certain system invariants:
1. **Audit Mutability**: Action patterns matching `delete_audit_log` or `clear_audit_log` are explicitly denied, regardless of how a policy is configured.
2. **Production Destruction**: Destructive actions in production always require approval and default to a high-risk categorization.
3. **Policy Modification Oversight**: Actions matching `manage_security_policy` force an approval and reauthentication requirement, protecting against unauthorized downgrades of security controls.

