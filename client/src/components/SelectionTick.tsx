import { Check } from "lucide-react";

/**
 * The tick on a library card (4 Nov 2026). It was a dark blue outline tick on a
 * near-black chip, so a selected card barely looked selected. Selected is now a
 * solid brand-blue box with a white check, and the thumbnail takes a light blue
 * wash; unselected stays an empty box readable on any frame.
 */
export function SelectionTick({ selected }: { selected: boolean }) {
  return (
    <>
      {selected && <span aria-hidden="true" className="absolute inset-0 bg-primary/15 pointer-events-none" />}
      <span
        aria-hidden="true"
        className={`absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-md transition-[background-color,box-shadow,transform] duration-150 ease-out ${
          selected
            ? "bg-primary ring-2 ring-white shadow-md shadow-primary/40 scale-105"
            : "bg-black/40 ring-[1.5px] ring-white/85 backdrop-blur-sm"
        }`}
      >
        {selected && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
      </span>
    </>
  );
}
