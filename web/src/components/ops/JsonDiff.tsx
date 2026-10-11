/** Field-level before → after comparison for audit entries. */

type Json = unknown;

function flatten(v: Json, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (v === null || v === undefined) {
    if (prefix) out[prefix] = v === null ? 'null' : '';
    return out;
  }
  if (Array.isArray(v)) {
    if (!v.length || v.every((x) => x === null || typeof x !== 'object')) out[prefix || '(ค่า)'] = JSON.stringify(v);
    else v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, Json>);
    if (!entries.length && prefix) out[prefix] = '{}';
    for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix || '(ค่า)'] = String(v);
  return out;
}

export function JsonDiff({ before, after }: { before: Json; after: Json }) {
  if (before == null && after == null) return <div className="small muted">ไม่มีข้อมูลก่อน/หลัง</div>;
  const b = flatten(before);
  const a = flatten(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>ฟิลด์</th>
            <th>ก่อน</th>
            <th>หลัง</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const changed = b[k] !== a[k];
            return (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td className="mono" style={{ color: changed && k in b ? 'var(--color-danger)' : undefined, wordBreak: 'break-all' }}>
                  {k in b ? b[k] : <span className="muted">—</span>}
                </td>
                <td className="mono" style={{ color: changed && k in a ? 'var(--color-success)' : undefined, wordBreak: 'break-all', fontWeight: changed ? 600 : undefined }}>
                  {k in a ? a[k] : <span className="muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
