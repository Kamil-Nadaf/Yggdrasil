import { useEffect, useState } from "react";
import AbstractText from "./AbstractText";
import { findTables, serializeTable, type ParsedTable, type TableAlign } from "../lib/mdTable";

/** One markdown table, rendered as a real editable grid (Obsidian-style live
 * preview) instead of raw `| --- |` pipe syntax. Edits commit back to the
 * parent's source string on blur / on any row-column structural change. */
function TableWidget({
  table,
  onCommit,
}: {
  table: ParsedTable;
  onCommit: (start: number, end: number, text: string) => void;
}) {
  const [header, setHeader] = useState(table.header);
  const [rows, setRows] = useState(table.rows);
  const [aligns, setAligns] = useState(table.aligns);

  // Re-sync if this table's own content changed externally (e.g. undo, file switch).
  const contentKey = `${table.start}:${table.header.join("¦")}:${table.rows.map((r) => r.join("¦")).join("¦¦")}`;
  useEffect(() => {
    setHeader(table.header);
    setRows(table.rows);
    setAligns(table.aligns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  function commit(nextHeader: string[], nextRows: string[][], nextAligns: TableAlign[]) {
    onCommit(table.start, table.end, serializeTable({ header: nextHeader, aligns: nextAligns, rows: nextRows }));
  }

  function updateCell(rowIdx: number, colIdx: number, value: string) {
    if (rowIdx === -1) {
      setHeader((h) => h.map((c, i) => (i === colIdx ? value : c)));
    } else {
      setRows((rs) => rs.map((r, ri) => (ri === rowIdx ? r.map((c, i) => (i === colIdx ? value : c)) : r)));
    }
  }

  function addRow() {
    const next = [...rows, header.map(() => "")];
    setRows(next);
    commit(header, next, aligns);
  }

  function removeRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    commit(header, next, aligns);
  }

  function addColumn() {
    const nextHeader = [...header, "Column"];
    const nextAligns = [...aligns, null];
    const nextRows = rows.map((r) => [...r, ""]);
    setHeader(nextHeader);
    setAligns(nextAligns);
    setRows(nextRows);
    commit(nextHeader, nextRows, nextAligns);
  }

  function removeColumn(idx: number) {
    const nextHeader = header.filter((_, i) => i !== idx);
    const nextAligns = aligns.filter((_, i) => i !== idx);
    const nextRows = rows.map((r) => r.filter((_, i) => i !== idx));
    setHeader(nextHeader);
    setAligns(nextAligns);
    setRows(nextRows);
    commit(nextHeader, nextRows, nextAligns);
  }

  function blurCommit() {
    commit(header, rows, aligns);
  }

  return (
    <div className="md-table-widget">
      <table className="md-editable-table">
        <thead>
          <tr>
            {header.map((h, ci) => (
              <th key={ci}>
                <div className="md-table-cell-row">
                  <input value={h} onChange={(e) => updateCell(-1, ci, e.target.value)} onBlur={blurCommit} />
                  {header.length > 1 && (
                    <button type="button" className="md-table-remove-btn" title="Remove column" onClick={() => removeColumn(ci)}>
                      ×
                    </button>
                  )}
                </div>
              </th>
            ))}
            <th className="md-table-add-col-cell">
              <button type="button" className="md-table-add-btn" title="Add column" onClick={addColumn}>
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {header.map((_, ci) => (
                <td key={ci}>
                  <input value={row[ci] || ""} onChange={(e) => updateCell(ri, ci, e.target.value)} onBlur={blurCommit} />
                </td>
              ))}
              <td className="md-table-row-remove-cell">
                <button type="button" className="md-table-remove-btn" title="Remove row" onClick={() => removeRow(ri)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="md-table-add-row-btn" onClick={addRow}>
        + Row
      </button>
    </div>
  );
}

/**
 * Renders markdown with GFM tables swapped for live-editable grids — click a
 * cell and type, no `| --- | --- |` syntax needed. Everything else renders
 * read-only the same way it always did. `onChange` receives the full,
 * re-serialized markdown so the raw editor pane stays perfectly in sync.
 */
export default function EditableMarkdownPreview({
  source,
  onChange,
  className,
}: {
  source: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const tables = findTables(source);

  function handleCommit(start: number, end: number, text: string) {
    onChange(source.slice(0, start) + text + source.slice(end));
  }

  if (tables.length === 0) {
    return <AbstractText text={source} className={className} />;
  }

  const segments: JSX.Element[] = [];
  let cursor = 0;
  tables.forEach((t, idx) => {
    if (t.start > cursor) {
      const chunk = source.slice(cursor, t.start);
      if (chunk.trim()) segments.push(<AbstractText key={`text-${idx}`} text={chunk} />);
    }
    segments.push(<TableWidget key={`table-${t.start}`} table={t} onCommit={handleCommit} />);
    cursor = t.end;
  });
  if (cursor < source.length) {
    const chunk = source.slice(cursor);
    if (chunk.trim()) segments.push(<AbstractText key="text-last" text={chunk} />);
  }

  return <div className={className}>{segments}</div>;
}
