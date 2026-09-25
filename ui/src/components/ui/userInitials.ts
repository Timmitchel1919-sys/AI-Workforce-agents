/** "Shaquil Alienda" → "SA", "ada@example.test" → "A", "" → "?". */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}
