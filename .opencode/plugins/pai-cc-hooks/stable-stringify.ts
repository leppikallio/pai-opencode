export function stableStringify(value: unknown): string {
	const seen = new WeakSet<object>();

	const stringify = (v: unknown): string => {
		if (v === null) return "null";
		const t = typeof v;
		if (t === "string") return JSON.stringify(v);
		if (t === "number" || t === "boolean") return String(v);
		if (t !== "object") return JSON.stringify(String(v));

		const obj = v as object;
		if (seen.has(obj)) return '"[Circular]"';
		seen.add(obj);

		if (Array.isArray(v)) {
			return `[${v.map((x) => stringify(x)).join(",")}]`;
		}

		const record = v as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		const entries = keys.map(
			(key) => `${JSON.stringify(key)}:${stringify(record[key])}`,
		);
		return `{${entries.join(",")}}`;
	};

	return stringify(value);
}
