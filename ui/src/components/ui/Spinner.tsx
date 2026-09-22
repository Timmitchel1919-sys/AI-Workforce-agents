import "./ui.css";

export interface SpinnerProps { size?: 'small' | 'medium' | 'large' }

export function Spinner({ size = 'medium' }: SpinnerProps) {
  const s = size === 'small' ? 12 : size === 'large' ? 28 : 18;
  return <svg className="ui-spinner" width={s} height={s} viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="31.4 31.4" /></svg>;
}

export default Spinner;
