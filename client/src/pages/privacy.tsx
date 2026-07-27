/**
 * ============================================================================
 *  PRIVACY POLICY — STARTING TEMPLATE, NOT LEGAL ADVICE
 * ============================================================================
 *
 *  The text below is a reasonable, standard starting template written to
 *  describe how this application actually behaves (verified against the code:
 *  express-session cookie, Stripe, Cloudinary, Resend, Google Gemini, Sentry).
 *
 *  It MUST be reviewed and approved by the client and by a qualified lawyer
 *  before launch. It is NOT legal advice and has not been reviewed by counsel.
 *
 *  Before going live, replace every placeholder token:
 *      {{COMPANY_LEGAL_NAME}}   {{REGISTERED_ADDRESS}}   {{CONTACT_EMAIL}}
 *      {{DPO_CONTACT}}          {{GOVERNING_JURISDICTION}}
 *  and confirm the "Last updated" date, the retention periods, and the list of
 *  sub-processors are accurate for the entity that is actually operating.
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LegalSection, LegalList, Placeholder } from "@/components/LegalPage";

const LAST_UPDATED = "27 July 2026";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      testIdPrefix="privacy"
      siblingHref="/cookies"
      siblingLabel="Cookie Policy"
      siblingTestId="link-privacy-cookies"
      intro={
        <p className="text-white/60 text-sm leading-relaxed">
          This Privacy Policy explains how <Placeholder>{"{{COMPANY_LEGAL_NAME}}"}</Placeholder>{" "}
          ("Materialized", "we", "us") collects, uses, shares and protects personal
          data when you visit our website, create an account, or use the Materialized
          video-commerce platform (together, the "Service").
        </p>
      }
    >
      <LegalSection heading="1. Who we are">
        <p>
          The data controller for personal data described in this policy is{" "}
          <Placeholder>{"{{COMPANY_LEGAL_NAME}}"}</Placeholder>, registered at{" "}
          <Placeholder>{"{{REGISTERED_ADDRESS}}"}</Placeholder>.
        </p>
        <p>
          For any privacy question, or to exercise the rights described in section 9,
          contact us at <Placeholder>{"{{CONTACT_EMAIL}}"}</Placeholder>. Where a data
          protection officer or privacy representative has been appointed, they can be
          reached at <Placeholder>{"{{DPO_CONTACT}}"}</Placeholder>.
        </p>
      </LegalSection>

      <LegalSection heading="2. Who this policy covers">
        <p>
          Materialized is a marketplace connecting three types of user: creators who
          make shoppable videos, brands who supply products, and publishers who
          distribute videos. This policy applies to all three, and to visitors who
          simply browse the public site without registering.
        </p>
      </LegalSection>

      <LegalSection heading="3. Information we collect">
        <p>We collect the following categories of personal data:</p>
        <LegalList>
          <li>
            <strong className="text-white/80">Account data.</strong> Name or display
            name, email address, password (stored only as a salted hash, never in
            plain text), account role, and email-verification status.
          </li>
          <li>
            <strong className="text-white/80">Profile and brand data.</strong> Profile
            details, avatar or logo, company name, social handles, and any biography
            or description you choose to add.
          </li>
          <li>
            <strong className="text-white/80">Content you submit.</strong> Videos,
            thumbnails, images, product catalogues, campaign briefs, playlists and any
            other material you upload or import into the Service.
          </li>
          <li>
            <strong className="text-white/80">Commercial and payout data.</strong>{" "}
            Orders and commissions attributed to your videos or links, payout balances
            and history, subscription and billing status. Card numbers and bank details
            are entered directly with our payment processor and are{" "}
            <strong className="text-white/80">never stored on our servers</strong>.
          </li>
          <li>
            <strong className="text-white/80">Usage and device data.</strong> Video
            views, clicks, referral and UTM parameters, approximate location derived
            from IP address, browser and device type, pages viewed, and timestamps.
          </li>
          <li>
            <strong className="text-white/80">Communications.</strong> Messages sent
            through in-app mailbox or contact forms, and support correspondence.
          </li>
          <li>
            <strong className="text-white/80">Technical logs.</strong> Server logs and
            error reports generated when something goes wrong.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="4. How we use personal data">
        <LegalList>
          <li>To create and administer your account, and to authenticate you.</li>
          <li>To operate the Service: hosting and delivering videos, making them shoppable, and running campaigns.</li>
          <li>To attribute sales to the correct creator, brand and publisher, and to calculate and pay commissions.</li>
          <li>To process subscriptions, invoices and payouts.</li>
          <li>To provide analytics dashboards showing how your own content performs.</li>
          <li>To send service messages: verification links, password resets, payout notifications, and important account notices.</li>
          <li>To send marketing communications, where you have opted in or where permitted by law. You can opt out at any time.</li>
          <li>To detect, investigate and prevent fraud, abuse, and security incidents, including automated checks on uploaded content.</li>
          <li>To fix bugs, monitor reliability, and improve the Service.</li>
          <li>To comply with legal, accounting and tax obligations.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="5. Legal bases for processing (UK/EU GDPR)">
        <p>
          Where the UK GDPR or EU GDPR applies, we rely on the following legal bases:
        </p>
        <LegalList>
          <li>
            <strong className="text-white/80">Performance of a contract</strong> — to
            provide the Service you signed up for, including attribution and payouts.
          </li>
          <li>
            <strong className="text-white/80">Legitimate interests</strong> — to secure
            the platform, prevent fraud, understand aggregate usage, and improve our
            product, balanced against your rights and freedoms.
          </li>
          <li>
            <strong className="text-white/80">Consent</strong> — for optional marketing
            communications and any non-essential cookies. You may withdraw consent at
            any time.
          </li>
          <li>
            <strong className="text-white/80">Legal obligation</strong> — for tax,
            accounting, and responses to lawful requests.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="6. Cookies and similar technologies">
        <p>
          We use a small number of cookies and browser storage keys, principally to keep
          you signed in and to remember interface preferences. We do not currently set
          advertising cookies. Full detail is in our{" "}
          <Link
            href="/cookies"
            className="text-[#1351aa] hover:text-[#4a7ed6] underline"
            data-testid="link-privacy-cookie-policy"
          >
            Cookie Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="7. Service providers and sharing">
        <p>
          We do not sell personal data. We share it only with providers who process it
          on our behalf under contract, and only as needed to run the Service:
        </p>
        <LegalList>
          <li>
            <strong className="text-white/80">Stripe</strong> — payments, subscriptions,
            connected-account onboarding and creator payouts. Stripe acts as an
            independent controller for parts of this processing and applies its own
            privacy policy.
          </li>
          <li>
            <strong className="text-white/80">Cloudinary</strong> — storage, transcoding
            and delivery of video and image assets.
          </li>
          <li>
            <strong className="text-white/80">Resend</strong> — delivery of
            transactional email such as verification and password-reset messages.
          </li>
          <li>
            <strong className="text-white/80">Google (Gemini API)</strong> — automated
            analysis of uploaded content, including AI-generated-content detection and
            content classification. Submitted material is processed to return a result
            and is not used by us to build advertising profiles.
          </li>
          <li>
            <strong className="text-white/80">Sentry</strong> — application error
            monitoring. Our configuration disables performance tracing, disables
            default personal-data capture, and redacts tokens from URLs.
          </li>
          <li>
            <strong className="text-white/80">Hosting and database providers</strong> —
            our application hosting, content delivery and managed PostgreSQL database.
          </li>
          <li>
            <strong className="text-white/80">Brands and publishers</strong> — where you
            participate in a campaign or affiliate relationship, the relevant
            counterparty sees the information necessary to run and settle it, such as
            your display name and attributed performance.
          </li>
        </LegalList>
        <p>
          We may also disclose personal data where required by law, to enforce our
          terms, or in connection with a merger, acquisition or sale of assets — in
          which case we will notify affected users.
        </p>
      </LegalSection>

      <LegalSection heading="8. International transfers">
        <p>
          Some of our providers operate outside the UK and European Economic Area,
          including in the United States. Where personal data is transferred outside
          those areas, we rely on appropriate safeguards such as UK/EU Standard
          Contractual Clauses, the UK International Data Transfer Addendum, or an
          adequacy decision. You can request details of the safeguards in place by
          contacting <Placeholder>{"{{CONTACT_EMAIL}}"}</Placeholder>.
        </p>
      </LegalSection>

      <LegalSection heading="9. Your rights">
        <p>
          Depending on where you live, you may have the right to: access a copy of your
          personal data; correct inaccurate data; request erasure; restrict or object to
          processing, including profiling; receive your data in a portable format;
          withdraw consent; and complain to a supervisory authority.
        </p>
        <p>
          If you are in the UK, you can complain to the Information Commissioner's
          Office. If you are in the EEA, you can complain to your national data
          protection authority.
        </p>
        <p>
          If you are a California resident, you may additionally have the right to know
          what personal information is collected and disclosed, to request deletion or
          correction, and not to be discriminated against for exercising those rights.
          We do not sell or share personal information for cross-context behavioural
          advertising.
        </p>
        <p>
          To exercise any right, email{" "}
          <Placeholder>{"{{CONTACT_EMAIL}}"}</Placeholder>. We will respond within the
          period required by applicable law and may need to verify your identity first.
        </p>
      </LegalSection>

      <LegalSection heading="10. Data retention">
        <p>
          We keep personal data only as long as necessary for the purposes above. In
          general: account and profile data is kept while your account is active and for
          a limited period afterwards; transaction, commission and payout records are
          kept for the period required by tax and accounting law; session records expire
          within days; and error logs are kept for a short diagnostic window. When data
          is no longer needed it is deleted or irreversibly anonymised.
        </p>
      </LegalSection>

      <LegalSection heading="11. Security">
        <p>
          We use technical and organisational measures appropriate to the risk, including
          encryption in transit (HTTPS), hashed passwords, HTTP-only session cookies,
          role-based access controls, encryption of sensitive stored credentials, rate
          limiting, and audit logging. No system is perfectly secure, and we cannot
          guarantee absolute security of data transmitted to us.
        </p>
      </LegalSection>

      <LegalSection heading="12. Children">
        <p>
          The Service is not directed at children and is not intended for anyone under
          18. We do not knowingly collect personal data from children. If you believe a
          child has provided us with personal data, contact{" "}
          <Placeholder>{"{{CONTACT_EMAIL}}"}</Placeholder> and we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to this policy">
        <p>
          We may update this policy from time to time. The "Last updated" date at the
          top shows when it last changed. Where changes are material, we will give
          reasonable notice, for example by email or an in-app notice, before they take
          effect.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact us">
        <p>
          <Placeholder>{"{{COMPANY_LEGAL_NAME}}"}</Placeholder>
          <br />
          <Placeholder>{"{{REGISTERED_ADDRESS}}"}</Placeholder>
          <br />
          <Placeholder>{"{{CONTACT_EMAIL}}"}</Placeholder>
        </p>
        <p className="text-white/40 text-xs">
          This policy is governed by the laws of{" "}
          <Placeholder>{"{{GOVERNING_JURISDICTION}}"}</Placeholder>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
