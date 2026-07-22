import { Search, Download, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { SortDir } from "@/hooks/useTableControls";

interface TableToolbarProps {
  query: string;
  onQueryChange: (q: string) => void;
  onExport?: () => void;
  searchPlaceholder?: string;
  /** Disable export when there are no rows to export. */
  exportDisabled?: boolean;
  "data-testid"?: string;
  className?: string;
}

/**
 * Shared table toolbar: a search Input plus an "Export CSV" button. Reused
 * across every searchable/exportable table so the controls look and behave
 * identically. Wire `query`/`onQueryChange` to `useTableControls` and
 * `onExport` to `exportToCsv`.
 */
export function TableToolbar({
  query,
  onQueryChange,
  onExport,
  searchPlaceholder = "Search...",
  exportDisabled,
  "data-testid": testId,
  className,
}: TableToolbarProps) {
  return (
    <div className={cn("flex items-center gap-2 w-full sm:w-auto", className)}>
      <div className="relative flex-1 sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9"
          data-testid={testId ? `${testId}-search` : "input-table-search"}
        />
      </div>
      {onExport && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={onExport}
          disabled={exportDisabled}
          data-testid={testId ? `${testId}-export` : "button-export-csv"}
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
      )}
    </div>
  );
}

interface SortableHeaderProps {
  label: ReactNode;
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onSort: (key: string) => void;
  className?: string;
  icon?: ReactNode;
  "data-testid"?: string;
}

/**
 * A clickable `<TableHead>` that toggles sort on click and shows the active
 * direction. Standardizes the sortable-column markup that previously sat unused
 * (as static `ArrowUpDown` icons) in a few tables.
 */
export function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
  icon,
  "data-testid": testId,
}: SortableHeaderProps) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "gap-1 -ml-3 font-semibold",
          active && "text-foreground",
        )}
        onClick={() => onSort(sortKey)}
        data-testid={testId ?? `sort-${sortKey}`}
      >
        {icon}
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </Button>
    </TableHead>
  );
}
