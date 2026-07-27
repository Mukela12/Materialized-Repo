/**
 * Legal entity details used by the Privacy and Cookie policy pages.
 *
 * Supplied by the client on 27 July 2026. Keep this as the single source of
 * truth — the policy pages previously carried these as scattered placeholder
 * tokens, which is how {{COMPANY_LEGAL_NAME}} ended up rendering on the live site.
 *
 * NOTE ON `governingLaw`: inferred from the registered address (a New York LLC),
 * NOT explicitly confirmed by the client. Governing law is a legal choice rather
 * than something derivable from an address, so this should be confirmed before
 * the policies are relied upon. Everything else here was given verbatim.
 */
export const COMPANY = {
  legalName: "ONE30M LLC",
  registeredAddress: "101 Greenpoint Avenue, Brooklyn, NY 11222, United States",
  contactEmail: "contact@one30m.co",
  governingLaw: "the State of New York, United States",
} as const;
