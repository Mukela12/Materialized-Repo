/**
 * ============================================================================
 *  COOKIE POLICY — STARTING TEMPLATE, NOT LEGAL ADVICE
 * ============================================================================
 *
 *  The cookie table below was written against the actual code as of the last
 *  updated date:
 *    - `connect.sid`   server/index.ts (express-session, httpOnly, sameSite lax,
 *                      secure in production, 7-day maxAge, Postgres-backed store)
 *    - `sidebar_state` client/src/components/ui/sidebar.tsx (7-day, path=/)
 *    - `theme`         client/src/components/ThemeProvider.tsx (localStorage)
 *  There is currently NO analytics or advertising cookie anywhere in the app.
 *
 *  This text MUST be reviewed and approved by the client and by a qualified
 *  lawyer before launch. It is NOT legal advice.
 *
 *  Entity details are filled in from client/src/lib/company.ts (supplied by the
 *  client 27 Jul 2026). RE-VERIFY the cookie table if any analytics, advertising
 *  or A/B-testing tool is added — adding one changes the consent obligations for
 *  this site.
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LegalSection, LegalList } from "@/components/LegalPage";
import { COMPANY } from "@/lib/company";

const LAST_UPDATED = "27 July 2026";

interface CookieRow {
  name: string;
  provider: string;
  purpose: string;
  category: string;
  duration: string;
}

const COOKIES: CookieRow[] = [
  {
    name: "connect.sid",
    provider: "Materialized (first party)",
    purpose:
      "Keeps you signed in by linking your browser to a server-side session. Set as HTTP-only and SameSite=Lax, and marked Secure in production.",
    category: "Strictly necessary",
    duration: "7 days",
  },
  {
    name: "sidebar_state",
    provider: "Materialized (first party)",
    purpose:
      "Remembers whether you left the dashboard sidebar expanded or collapsed.",
    category: "Functional",
    duration: "7 days",
  },
  {
    name: "theme",
    provider: "Materialized (first party, localStorage — not a cookie)",
    purpose:
      "Remembers your light or dark appearance choice. Stored in your browser and never sent to our servers.",
    category: "Functional",
    duration: "Until you clear site data",
  },
];

export default function Cookies() {
  return (
    <LegalPage
      title="Cookie Policy"
      lastUpdated={LAST_UPDATED}
      testIdPrefix="cookies"
      siblingHref="/privacy"
      siblingLabel="Privacy Policy"
      siblingTestId="link-cookies-privacy"
      intro={
        <p className="text-white/60 text-sm leading-relaxed">
          This Cookie Policy explains how{" "}
          {COMPANY.legalName} ("Materialized", "we",
          "us") uses cookies and similar browser storage on the Materialized website and
          platform. It should be read alongside our{" "}
          <Link
            href="/privacy"
            className="text-[#1351aa] hover:text-[#4a7ed6] underline"
            data-testid="link-cookies-privacy-policy"
          >
            Privacy Policy
          </Link>
          .
        </p>
      }
    >
      <LegalSection heading="1. What cookies are">
        <p>
          A cookie is a small text file a website stores on your device. Cookies let a
          site recognise your browser between page loads — for example, so you stay
          signed in as you move around the app. We also use related browser features
          such as localStorage, which works similarly but keeps data only in your
          browser.
        </p>
      </LegalSection>

      <LegalSection heading="2. Cookies and storage we use">
        <p>
          We keep this deliberately small. The complete list of what Materialized itself
          sets is below.
        </p>
        <div className="overflow-x-auto -mx-1 mt-4">
          <table className="w-full min-w-[560px] text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/15">
                <th className="py-2 pr-4 font-semibold text-white/80">Name</th>
                <th className="py-2 pr-4 font-semibold text-white/80">Provider</th>
                <th className="py-2 pr-4 font-semibold text-white/80">Purpose</th>
                <th className="py-2 pr-4 font-semibold text-white/80">Category</th>
                <th className="py-2 font-semibold text-white/80">Duration</th>
              </tr>
            </thead>
            <tbody data-testid="table-cookies-list">
              {COOKIES.map((c) => (
                <tr key={c.name} className="border-b border-white/10 align-top">
                  <td className="py-3 pr-4 font-mono text-white/80 whitespace-nowrap">{c.name}</td>
                  <td className="py-3 pr-4 text-white/50">{c.provider}</td>
                  <td className="py-3 pr-4 text-white/50">{c.purpose}</td>
                  <td className="py-3 pr-4 text-white/50 whitespace-nowrap">{c.category}</td>
                  <td className="py-3 text-white/50 whitespace-nowrap">{c.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection heading="3. What we do not use">
        <p>
          Materialized does not set advertising cookies, does not run a third-party
          advertising pixel, and does not use a general-purpose web analytics tracker on
          this site. We do not sell or share cookie data for cross-context behavioural
          advertising.
        </p>
        <p>
          The analytics you see inside the product — video views, clicks, referral and
          UTM attribution — are recorded server-side against your account and the
          campaign links you use, not through advertising cookies in your browser.
        </p>
      </LegalSection>

      <LegalSection heading="4. Third-party services">
        <p>
          Some pages load resources from, or hand you off to, third parties. Those
          parties may set their own cookies under their own policies:
        </p>
        <LegalList>
          <li>
            <strong className="text-white/80">Stripe</strong> — used for checkout,
            subscriptions and payouts. Stripe sets cookies for payment processing and
            fraud prevention when you interact with its hosted flows.
          </li>
          <li>
            <strong className="text-white/80">Cloudinary</strong> — delivers video and
            image assets from its content delivery network.
          </li>
          <li>
            <strong className="text-white/80">Google Fonts</strong> — serves the
            typefaces used across the site.
          </li>
          <li>
            <strong className="text-white/80">Sentry</strong> — captures application
            errors so we can fix them. It is configured without performance tracing and
            without default personal-data capture.
          </li>
        </LegalList>
        <p>
          Embedded Materialized players placed on a publisher's own website may also be
          subject to that website's cookie notice.
        </p>
      </LegalSection>

      <LegalSection heading="5. Legal basis and consent">
        <p>
          The <span className="font-mono text-white/70">connect.sid</span> cookie is
          strictly necessary to deliver a service you have requested — signing in — and
          under UK and EU rules does not require consent. Functional preferences such as
          sidebar and theme are set only in response to an action you take in the
          interface.
        </p>
        <p>
          If we later introduce analytics or advertising cookies, we will update this
          policy and ask for your consent before setting them.
        </p>
      </LegalSection>

      <LegalSection heading="6. How to manage cookies">
        <p>
          You can delete or block cookies through your browser settings, usually under
          Privacy or Site Settings. Most browsers also offer a private or incognito
          window that discards cookies when closed.
        </p>
        <p>
          Blocking the session cookie will prevent you from signing in and using the
          platform. Blocking functional storage only means your interface preferences are
          not remembered.
        </p>
        <p>
          You can also clear the stored theme preference by clearing site data for this
          domain.
        </p>
      </LegalSection>

      <LegalSection heading="7. Changes to this policy">
        <p>
          We will update this page whenever the cookies or storage we use change. The
          "Last updated" date at the top shows when it last changed.
        </p>
      </LegalSection>

      <LegalSection heading="8. Contact us">
        <p>
          Questions about this policy? Contact{" "}
          {COMPANY.legalName} at{" "}
          {COMPANY.contactEmail},{" "}
          {COMPANY.registeredAddress}.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
