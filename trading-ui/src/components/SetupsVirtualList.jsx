import { memo, useEffect } from "react";
import { List, useListRef } from "react-window";

function formatTime(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Date(value * 1000).toISOString().replace("T", " ").replace(".000Z", "Z");
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }

  return num.toFixed(5);
}

function formatReturn(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }

  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(2)}%`;
}

function SetupRow({ index, style, setups, selectedSetupId, onSelect }) {
  const setup = setups[index];
  const isSelected = setup?.id === selectedSetupId;
  const returnPct = Number(setup?.return_pct);
  const returnTone = Number.isFinite(returnPct)
    ? returnPct >= 0
      ? "text-[var(--color-bull)]"
      : "text-[var(--color-bear)]"
    : "text-[var(--color-text-secondary)]";

  return (
    <div style={style} className="px-2 py-1.5">
      <button
        type="button"
        onClick={() => onSelect(setup)}
        className={[
          "w-full rounded-xl border px-4 py-3 text-left transition",
          isSelected
            ? "border-white/15 bg-white/8"
            : "border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] hover:border-white/10 hover:bg-white/5",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
              #{String(setup?.sequence ?? index + 1).padStart(2, "0")} {setup?.direction}
            </div>
            <div className="mt-1 truncate text-sm font-medium text-[var(--color-text)]">{setup?.label || "Signal"}</div>
            <div className="mt-2 text-xs text-[var(--color-text-secondary)]">{formatTime(setup?.entry_time)}</div>
          </div>

          <div className="shrink-0 text-right">
            <div className={`text-sm font-semibold ${returnTone}`}>{formatReturn(setup?.return_pct)}</div>
            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">{setup?.bars_held ?? 0} bars</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
          <span className="truncate">Entry {formatPrice(setup?.entry_price)}</span>
          <span className="truncate">Exit {formatPrice(setup?.exit_price)}</span>
        </div>
      </button>
    </div>
  );
}

function SetupsVirtualList({ setups, selectedSetupId, onSelect }) {
  const listRef = useListRef();

  useEffect(() => {
    if (!selectedSetupId) {
      return;
    }

    const index = setups.findIndex((setup) => setup.id === selectedSetupId);
    if (index >= 0) {
      listRef.current?.scrollToRow({ index, align: "smart" });
    }
  }, [listRef, selectedSetupId, setups]);

  return (
    <List
      className="h-full"
      defaultHeight={520}
      listRef={listRef}
      overscanCount={6}
      rowComponent={SetupRow}
      rowCount={setups.length}
      rowHeight={104}
      rowProps={{ setups, selectedSetupId, onSelect }}
      style={{ height: "100%" }}
    />
  );
}

export default memo(SetupsVirtualList);
