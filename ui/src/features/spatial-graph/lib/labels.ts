import type { MessageKey, MessageParams } from "../../../i18n";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * The catalogues carry a label per contract type; unknown/future types fall back to a
 * readable form of the raw identifier instead of showing a missing-key string.
 */
function labelOr(t: Translate, key: string, raw: string): string {
  const value = t(key as MessageKey);
  return value === key ? raw.toLowerCase().replace(/_/g, " ") : value;
}

export const nodeTypeLabel = (t: Translate, type: string): string =>
  labelOr(t, `spatial.nodeType.${type}`, type);
export const edgeTypeLabel = (t: Translate, type: string): string =>
  labelOr(t, `spatial.edgeType.${type}`, type);
export const stateLabel = (t: Translate, state: string): string =>
  labelOr(t, `spatial.state.${state}`, state);
export const filterLabel = (t: Translate, filter: string): string =>
  filter === "ALL" ? t("spatial.filters.all") : labelOr(t, `spatial.filters.${filter}`, filter);
export const edgeStatusLabel = (t: Translate, status: string): string =>
  labelOr(t, `spatial.edgeStatus.${status}`, status);
export const modeLabel = (t: Translate, mode: string): string => labelOr(t, `spatial.modes.${mode}`, mode);
