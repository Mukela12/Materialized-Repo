/**
 * The (i) next to every "Upload CSV": how to lay out the file, in plain words,
 * with an example. Asked for by the client on 29 Sep 2026 so people know the
 * format before they hit an error. A popover rather than a tooltip, so it
 * opens with a tap on a phone.
 */
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function CsvFormatHint({
  required,
  optional = [],
  example,
  note,
  testId = "button-csv-format-hint",
}: {
  /** Column names that must be there, as people would write them. */
  required: string[];
  optional?: string[];
  /** A heading row and a row or two of data, exactly as the file would read. */
  example: string[];
  note?: string;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="How to format the CSV"
          data-testid={testId}
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 text-sm" data-testid="csv-format-hint">
        <p className="font-medium">How to format your CSV</p>
        <p className="text-muted-foreground">
          One person per row. The first row names the columns:{" "}
          <span className="font-medium text-foreground">{required.join(" and ")}</span>
          {optional.length > 0 && <>, plus {optional.join(" or ")} if you like</>}.
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">{example.join("\n")}</pre>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Headings like "Full Name", "First Name" and "Last Name", or "Email Address" work too.</li>
          <li>Commas inside a cell are fine when you save from Excel or Google Sheets.</li>
          <li>In Excel: File, Save As, CSV. In Google Sheets: File, Download, CSV.</li>
          {note && <li>{note}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
