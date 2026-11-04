import "./ecosystem-flow-arrow.css";

/*
 * The drawn arrow used in the Creator and Brand demos (4 Nov 2026). The client
 * asked for no emoji anywhere on the site: text arrows like → and ↗ render as
 * emoji on iPhones. A light runs along the line into the head, so the arrow
 * reads as movement. Point it with CSS (rotate) on the wrapper.
 */
export function FlowArrow({ className = "" }: { className?: string }) {
  return (
    <svg className={`flow-arrow ${className}`.trim()} viewBox="0 0 44 16" fill="none" aria-hidden="true" focusable="false">
      <path className="flow-arrow-track" d="M2 8H37" />
      <path className="flow-arrow-run" d="M2 8H37" pathLength={40} />
      <path className="flow-arrow-head" d="M31.5 2.5 37.5 8l-6 5.5" />
    </svg>
  );
}
