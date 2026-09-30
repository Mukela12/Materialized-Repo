/**
 * Copying text, in more places than the Clipboard API alone reaches.
 *
 * navigator.clipboard is refused in embedded browsers, some in-app webviews
 * and when the page is not focused, and every copy button called it without
 * a fallback: "Copy shoppable link" said it failed (client's screenshot, 30
 * Sep 2026) and "Copy" on the embed code said "Copied!" while copying
 * nothing. This tries the API, then the older selection copy, and reports
 * honestly whether either worked, so the caller can show the text instead.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused: try the selection copy */
  }
  return selectionCopy(text);
}

function selectionCopy(text: string): boolean {
  // Inside a dialog, the dialog's focus trap pulls focus back from anything
  // outside it, which would leave nothing selected; so put the helper inside.
  const host = (document.activeElement?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  host.appendChild(ta);
  const previous = document.activeElement as HTMLElement | null;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    previous?.focus?.();
  }
}
