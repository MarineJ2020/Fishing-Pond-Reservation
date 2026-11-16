import React from 'react';

/** Every CMS table shows at most this many rows per page. */
export const TABLE_PAGE_SIZE = 50;

/** "Jumlah N rekod" shown at the top-left corner above a table (count after filters). */
export const TableTotal: React.FC<{ total: number | null; loading?: boolean; page?: number; pageSize?: number }> = ({
  total, loading, page = 0, pageSize = TABLE_PAGE_SIZE,
}) => {
  const range = total && total > pageSize
    ? ` · memaparkan ${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)}`
    : '';
  return (
    <div className="cms-table-total">
      {total == null ? (loading ? 'Mengira rekod…' : '') : <>Jumlah <strong>{total.toLocaleString('ms-MY')}</strong> rekod{range}</>}
    </div>
  );
};

/** ← Sebelum · Halaman x / y · Seterus →. Hidden when everything fits on one page. */
export const TablePager: React.FC<{
  page: number;
  /** null when the total is unknown (server paging without a count yet). */
  pageCount: number | null;
  hasNext?: boolean;
  onPage: (page: number) => void;
  className?: string;
}> = ({ page, pageCount, hasNext, onPage, className = '' }) => {
  const canNext = pageCount == null ? !!hasNext : page < pageCount - 1;
  if (page === 0 && !canNext) return null;
  return (
    <div className={`cms-pagination ${className}`.trim()}>
      <button type="button" className="btn btn-sm btn-ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>← Sebelum</button>
      <span>Halaman {page + 1}{pageCount != null ? ` / ${pageCount}` : ''}</span>
      <button type="button" className="btn btn-sm btn-ghost" disabled={!canNext} onClick={() => onPage(page + 1)}>Seterus →</button>
    </div>
  );
};

export type PagedTable<T> = {
  rows: T[];
  page: number;
  total: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** Count line for above the table. */
  totalEl: React.ReactElement;
  /** Pager for below the table (null when one page). */
  pagerEl: React.ReactElement;
};

/**
 * Client-side paging for tables whose rows are already in memory. Page state
 * lives in one record keyed by table id, so it works inside the CMS's
 * conditional render blocks (no per-table hooks). `sig` = the table's filter
 * values: when it changes the table jumps back to page 1.
 */
export const makeTablePaging = (
  pages: Record<string, { page: number; sig: string }>,
  setPages: React.Dispatch<React.SetStateAction<Record<string, { page: number; sig: string }>>>,
) => <T,>(key: string, rows: T[], sig = ''): PagedTable<T> => {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
  const saved = pages[key];
  const page = saved && saved.sig === sig ? Math.min(Math.max(0, saved.page), pageCount - 1) : 0;
  const onPage = (next: number) => setPages((prev) => ({ ...prev, [key]: { page: next, sig } }));
  return {
    rows: rows.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE),
    page,
    total,
    pageCount,
    onPage,
    totalEl: <TableTotal total={total} page={page} />,
    pagerEl: <TablePager page={page} pageCount={pageCount} onPage={onPage} />,
  };
};
