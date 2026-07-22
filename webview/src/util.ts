export function stringifyCell(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") {
    return v.toString();
  }
  return JSON.stringify(v) ?? "";
}

const NUMERIC_AFFINITY = /(INT|REAL|FLOA|DOUB|NUMERIC|DECIMAL)/i;

export function isNumericType(type: string): boolean {
  return NUMERIC_AFFINITY.test(type);
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}
