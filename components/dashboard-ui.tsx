"use client";

import { useEffect, useRef, useState } from "react";

import { type Setting, type Stone } from "@/lib/types";

export const pageSizes = [20, 50, 100] as const;

export function SectionCard({
  eyebrow,
  title,
  children,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`section-card${compact ? " section-card--compact" : ""}`}>
      <div className="section-head">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function StatusPill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warning" | "rose";
}) {
  return <span className={`status-pill${tone === "default" ? "" : ` status-pill--${tone}`}`}>{children}</span>;
}

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function QuoteItem({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`quote-item${highlight ? " quote-item--highlight" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function SelectionCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note?: string;
}) {
  return (
    <article className="selection-card">
      <p>{title}</p>
      <strong>{value}</strong>
      {note ? <span>{note}</span> : null}
    </article>
  );
}

export function SheetMapItem({ label, value }: { label: string; value: string }) {
  return (
    <article className="sheet-map-item">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

export function PaginationButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="pagination-button" type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function InlineButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="inline-button" type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function CatalogPanel<T extends Stone | Setting>({
  kind,
  searchValue,
  searchPlaceholder,
  helpText,
  searchActions,
  searchNote,
  filters,
  columns,
  items,
  total,
  page,
  totalPages,
  pageSize,
  loading,
  error,
  selectedId,
  suggestions,
  onSearchChange,
  onPageSizeChange,
  onPrev,
  onNext,
  onSelect,
  onSuggestionSelect,
  renderRow,
  renderSuggestion,
  detail,
}: {
  kind: "stone" | "setting";
  searchValue: string;
  searchPlaceholder: string;
  helpText?: string;
  searchActions?: React.ReactNode;
  searchNote?: string;
  filters?: React.ReactNode;
  columns: string[];
  items: T[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: (typeof pageSizes)[number];
  loading: boolean;
  error: string;
  selectedId: string;
  suggestions: T[];
  onSearchChange: (value: string) => void;
  onPageSizeChange: (value: (typeof pageSizes)[number]) => void;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (item: T) => void;
  onSuggestionSelect: (item: T) => void;
  renderRow: (item: T) => React.ReactNode;
  renderSuggestion: (item: T) => string;
  detail: React.ReactNode;
}) {
  const getItemId = (item: T) => (kind === "stone" ? (item as Stone).stone_id : (item as Setting).setting_id);
  const getItemTitle = (item: T) => (kind === "stone" ? (item as Stone).name : (item as Setting).style);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!searchShellRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!searchValue.trim() || suggestions.length === 0) {
      setShowSuggestions(false);
    }
  }, [searchValue, suggestions.length]);

  return (
    <>
      <div className="catalog-toolbar">
        <div className="catalog-toolbar__main">
          <Field label={`Search ${kind}s`}>
            <div ref={searchShellRef} className="catalog-search-shell">
              <input
                className="field-control"
                value={searchValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onSearchChange(nextValue);
                  setShowSuggestions(nextValue.trim().length > 0);
                }}
                onFocus={() => {
                  if (searchValue.trim() && suggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                placeholder={searchPlaceholder}
              />
              {showSuggestions && suggestions.length > 0 ? (
                <div className="catalog-suggestions">
                  {suggestions.map((item) => (
                    <button
                      key={getItemId(item)}
                      className="catalog-suggestion"
                      type="button"
                      onClick={() => {
                        onSuggestionSelect(item);
                        setShowSuggestions(false);
                      }}
                    >
                      <strong>{getItemTitle(item)}</strong>
                      <span>{renderSuggestion(item)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Field>
          {helpText ? <p className="catalog-help">{helpText}</p> : null}
          {searchActions ? <div className="catalog-search-actions">{searchActions}</div> : null}
          {searchNote ? <p className="catalog-help catalog-help--accent">{searchNote}</p> : null}
          {filters ? <div className="catalog-filters">{filters}</div> : null}
        </div>
      </div>
      <div className="catalog-grid catalog-grid--compact">
        <div className="table-card table-card--catalog">
          <div className="table-card__header">
            <h3>{kind === "stone" ? "Stone matches" : "Setting matches"}</h3>
            <span>{error || `${total} matches`}</span>
          </div>
          <div className="table-scroll-shell">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((item) => (
                  <tr
                    key={getItemId(item)}
                    className={getItemId(item) === selectedId ? "is-selected" : ""}
                    onClick={() => {
                      onSelect(item);
                      setShowSuggestions(false);
                    }}
                  >
                      {renderRow(item)}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length}>
                      <p className="empty-state">No matches.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="catalog-footer">
            <div className="catalog-footer__meta">
              <Field label="Rows">
                <select
                  className="field-control compact-select"
                  value={pageSize}
                  onChange={(event) => onPageSizeChange(Number(event.target.value) as (typeof pageSizes)[number])}
                >
                  {pageSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="catalog-meta">
                <strong>{total === 0 ? "0 results" : `${(page - 1) * pageSize + 1}-${Math.min(total, page * pageSize)} of ${total}`}</strong>
                <span>{loading ? "Refreshing..." : "Filtered"}</span>
              </div>
            </div>
            <div className="catalog-footer__paging">
              <PaginationButton disabled={page <= 1 || loading} onClick={onPrev}>
                Previous
              </PaginationButton>
              <span className="inline-note">
                Page {page} of {totalPages}
              </span>
              <PaginationButton disabled={page >= totalPages || loading} onClick={onNext}>
                Next
              </PaginationButton>
            </div>
          </div>
        </div>
        <div className="detail-card detail-card--catalog">{detail}</div>
      </div>
    </>
  );
}
