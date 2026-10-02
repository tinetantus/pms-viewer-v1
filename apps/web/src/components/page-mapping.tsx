'use client';
export type PageMapping = { before: number; after: number };
export function PageMappingEditor({
  beforeCount,
  afterCount,
  value,
  onChange,
}: {
  beforeCount: number;
  afterCount: number;
  value: PageMapping[];
  onChange: (value: PageMapping[]) => void;
}) {
  return (
    <details className="page-mapping">
      <summary>Review page correspondence</summary>
      <p className="fine">
        Leave empty for conservative automatic matching. Set an explicit map if pages moved or
        changed substantially.
      </p>
      {Array.from({ length: afterCount }, (_, i) => (
        <label className="inline-label" key={i}>
          After page {i + 1}
          <select
            aria-label={`Before page for after page ${i + 1}`}
            value={value.find((m) => m.after === i + 1)?.before || ''}
            onChange={(e) =>
              onChange([
                ...value.filter((m) => m.after !== i + 1),
                ...(e.target.value ? [{ before: Number(e.target.value), after: i + 1 }] : []),
              ])
            }
          >
            <option value="">Automatic / unmapped</option>
            {Array.from({ length: beforeCount }, (_, j) => (
              <option key={j} value={j + 1}>
                Before page {j + 1}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="button" onClick={() => onChange([])}>
        Reset to automatic
      </button>
    </details>
  );
}
