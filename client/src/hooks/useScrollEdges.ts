import { useCallback, useRef, type MutableRefObject, type Ref } from "react";

/**
 * Marks a horizontal scroller with data-overflow-start / data-overflow-end
 * while there is hidden content on that side. The `.scroll-fade` class in
 * index.css turns those into edge fades, so a row of pills that runs off the
 * screen looks like it scrolls instead of looking cut off.
 *
 * Returns a callback ref so it can be merged with a forwarded ref.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const cleanup = useRef<() => void>();

  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = undefined;
    if (!el) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      // 1px of slack: fractional widths leave scrollLeft a hair short of max.
      el.toggleAttribute("data-overflow-start", el.scrollLeft > 1);
      el.toggleAttribute("data-overflow-end", max - el.scrollLeft > 1);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    // Children changing width (labels swapping at a breakpoint, fonts loading)
    // changes scrollWidth without resizing the scroller itself.
    Array.from(el.children).forEach((c) => ro?.observe(c));

    cleanup.current = () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
}

/** Point several refs (callback or object) at one element. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) (ref as MutableRefObject<T | null>).current = value;
    }
  };
}
