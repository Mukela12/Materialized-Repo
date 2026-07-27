/**
 * Shared shell for the public legal pages (/privacy, /cookies).
 *
 * Colours are hardcoded rather than using the `bg-card` / `text-foreground` theme
 * tokens on purpose: these pages are linked from the dark landing footer and are
 * reachable logged-out, so a light-mode visitor must still get the dark treatment.
 * Same approach the landing page takes.
 */
import { useEffect } from "react";
import { Link } from "wouter";
import materializedLogo from "@assets/MTRLZD_Logo_white_transparent.png";

interface LegalPageProps {
  title: string;
  lastUpdated: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  /** Reciprocal link to the sibling policy. */
  siblingHref: string;
  siblingLabel: string;
  siblingTestId: string;
  testIdPrefix: string;
}

export function LegalPage({
  title,
  lastUpdated,
  intro,
  children,
  siblingHref,
  siblingLabel,
  siblingTestId,
  testIdPrefix,
}: LegalPageProps) {
  // No global scroll restoration exists in this app, and these pages are entered
  // from the bottom of a very long landing page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-[#020410] px-4 py-12 md:py-16">
      <div className="w-full max-w-3xl mx-auto">
        <div className="flex justify-center mb-8">
          <Link href="/" data-testid={`link-${testIdPrefix}-logo-home`}>
            <img src={materializedLogo} alt="Materialized" className="h-24 w-auto" />
          </Link>
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 sm:p-8 md:p-10 shadow-xl">
          <h1
            className="text-2xl md:text-3xl font-semibold text-white mb-2"
            data-testid={`text-${testIdPrefix}-title`}
          >
            {title}
          </h1>
          <p
            className="text-white/40 text-xs mb-8"
            data-testid={`text-${testIdPrefix}-last-updated`}
          >
            Last updated: {lastUpdated}
          </p>

          {intro && <div className="mb-8">{intro}</div>}

          <div className="space-y-8">{children}</div>

          <div className="mt-10 pt-6 border-t border-white/10">
            <p className="text-white/60 text-sm">
              See also:{" "}
              <Link
                href={siblingHref}
                className="text-[#1351aa] hover:text-[#4a7ed6] underline"
                data-testid={siblingTestId}
              >
                {siblingLabel}
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm text-white/40 hover:text-white transition-colors"
            data-testid={`link-${testIdPrefix}-back-home`}
          >
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A numbered top-level section of a policy. */
export function LegalSection({
  id,
  heading,
  children,
}: {
  id?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="text-lg font-semibold text-white mb-3">{heading}</h2>
      <div className="space-y-3 text-white/60 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/** A sub-heading inside a section. */
export function LegalSubheading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-white/90 mt-5 mb-2">{children}</h3>;
}

/** Bulleted list with the muted body treatment. */
export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-2 marker:text-white/30">{children}</ul>;
}

/** Inline placeholder token the client must replace before launch. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[#4a7ed6] font-medium" title="Placeholder — replace before launch">
      {children}
    </span>
  );
}
