import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { homepageExplainerMedia } from "./homepage-explainer-media";
import "./brand-ecosystem/BrandEcosystemSection.css";

type BrandEcosystemSectionProps = { onUnlockTrial: () => void; embedded?: boolean };

const slides = [
  {
    title: "A creator’s video, ready for your brand.",
    support: "Accept a creator’s email, pay the $29 Admin Setup Fee, and find the accepted video in My Campaigns.",
  },
  {
    title: "Preview once. Publish where shoppers browse.",
    support: "Paste the influencer’s video embed into your eCommerce as a vertical player or a shoppable product thumbnail.",
  },
  {
    title: "Let your audience know it’s shoppable.",
    support: "Share a preview to Instagram and TikTok. Your audience can shop the videos on your eCommerce.",
  },
  {
    title: "Bring your influencer program with you.",
    support: "Import your existing program from CSV. Invited influencers get FREE access to Video Commerce tools.",
  },
  {
    title: "One library. More reach.",
    support: "The Global Content Library brings creator and publisher audiences to your brand. Creator attribution and publisher commission stay intact.",
  },
  {
    title: "See activity. Set creator commission.",
    support: "Track affiliate engagement and transaction value, then adjust influencer commission in your dashboard.",
  },
];

function RequestScene() {
  return (
    <div className="be-illustration be-request-flow" aria-hidden="true">
      <div className="be-accept-panel">
        <div className="be-request-mail">
          <span className="be-mail-mark">M</span>
          <span><b>Creator invitation</b><small>New shoppable video request</small></span>
        </div>
        <p className="be-request-copy">“Would you like to make my video shoppable for your brand?”</p>
        <div className="be-action-row"><span>Accept invitation</span><b>Accepted ✓</b></div>
        <div className="be-payment">Admin Setup Fee <strong>$29</strong></div>
      </div>
      <span className="be-flow-arrow">→</span>
      <div className="be-dashboard">
        <div className="be-dash-top"><span>My Campaigns</span><span>BRAND DASHBOARD</span></div>
        <div className="be-campaign-row">
          <span className="be-video-thumb" />
          <span><strong>Creator video · shoppable</strong><small>Accepted video</small></span>
        </div>
        <span className="be-published-chip">Added to My Campaigns</span>
      </div>
    </div>
  );
}

function StorefrontScene() {
  return (
    <div className="be-illustration be-storefronts" aria-hidden="true">
      <div className="be-store">
        <div className="be-store-nav"><span className="be-store-brand">FORM / STUDIO</span><span className="be-store-mini">SHOP &nbsp; NEW &nbsp; BAG</span></div>
        <div className="be-store-content">
          <span className="be-store-kicker">VERTICAL VIDEO EMBED</span>
          <div className="be-shop-video"><span className="be-play">▶</span><span className="be-shop-overlay"><span>Creator styling edit</span><b>Buy Now</b></span></div>
          <div className="be-store-product"><span>In the frame</span><b>Buy Now</b></div>
        </div>
      </div>
      <div className="be-store">
        <div className="be-store-nav"><span className="be-store-brand">FORM / NEW IN</span><span className="be-store-mini">FILTER &nbsp; BAG</span></div>
        <div className="be-store-content">
          <span className="be-store-kicker">SHOPPABLE PRODUCT THUMBNAIL</span>
          <div className="be-thumb-shot"><span className="be-mini-model" /></div>
          <div className="be-thumbnail-caption"><span>Shown in creator video</span><b>Buy Now</b></div>
        </div>
      </div>
    </div>
  );
}

function SocialScene() {
  return (
    <div className="be-illustration be-share-stage" aria-hidden="true">
      <div className="be-phone" data-testid="brand-story-device">
        <div className="be-phone-screen">
          <div className="be-phone-notch" />
          <div className="be-story-bar">
            <span className="be-story-avatar">M</span>
            <span>@join.materialized</span>
            <span className="be-story-live">Story</span>
          </div>
          <div className="be-story-scene" data-testid="brand-story-viewport">
            <span className="be-story-note">OUR NEW VIDEO IS SHOPPABLE</span>
            <div className="be-product-carousel">
              <div className="be-product-tile">
                <div className="be-product-art">
                  <svg viewBox="0 0 48 40" focusable="false">
                    <path d="M19 3h10l-2 10 9 24H12l9-24z" fill="#29272b" />
                    <path d="M19 3l5 6 5-6" fill="none" stroke="#e3c397" strokeWidth="1.5" />
                  </svg>
                </div>
                <span className="be-product-name">Evening dress</span>
                <span className="be-preorder">Pre Order</span>
              </div>
              <div className="be-product-tile">
                <div className="be-product-art">
                  <svg viewBox="0 0 48 40" focusable="false">
                    <rect x="9" y="14" width="30" height="22" rx="5" fill="#9b4933" />
                    <path d="M17 16V11a7 7 0 0114 0v5" fill="none" stroke="#593524" strokeWidth="3" />
                    <circle cx="24" cy="23" r="2" fill="#f4d48f" />
                  </svg>
                </div>
                <span className="be-product-name">Leather bag</span>
                <span className="be-preorder">Pre Order</span>
              </div>
              <div className="be-product-tile">
                <div className="be-product-art">
                  <svg viewBox="0 0 48 40" focusable="false">
                    <ellipse cx="17" cy="21" rx="8" ry="13" fill="none" stroke="#91632c" strokeWidth="4" />
                    <ellipse cx="31" cy="21" rx="8" ry="13" fill="none" stroke="#ffdda0" strokeWidth="4" />
                  </svg>
                </div>
                <span className="be-product-name">Gold hoops</span>
                <span className="be-preorder">Pre Order</span>
              </div>
            </div>
            <svg className="be-hearts" viewBox="0 0 92 145" focusable="false" aria-hidden="true">
              <path className="be-heart" d="M31 41 C19 30 4 45 31 65 C58 45 43 30 31 41Z" fill="#e43e4d" />
              <path className="be-heart" d="M61 72 C52 63 41 74 61 89 C81 74 70 63 61 72Z" fill="#e43e4d" />
              <path className="be-heart" d="M28 103 C21 96 12 105 28 117 C44 105 35 96 28 103Z" fill="#e43e4d" />
            </svg>
          </div>
          <div className="be-story-caption">
            <b>Watch the video, shop the pieces.</b>
            <br />
            Find it on our eCommerce.
          </div>
        </div>
      </div>
      <div className="be-social-stack">
        <div className="be-social-destination">
          <span className="be-social-mark">IG</span>
          <span>Instagram Story<small>Preview + product carousel</small></span>
        </div>
        <div className="be-social-destination">
          <span className="be-social-mark">TT</span>
          <span>TikTok<small>Shoppable video preview</small></span>
        </div>
        <div className="be-comments">
          <span className="be-comment">“Love the whole look. Shop link?”</span>
          <span className="be-comment">“Tap the products in our video.”</span>
        </div>
      </div>
    </div>
  );
}

const roster = [
  { initials: "AM", name: "Ari Morgan", role: "Style creator" },
  { initials: "JL", name: "Jules Lane", role: "Video creator" },
  { initials: "SK", name: "Sage Kim", role: "Beauty creator" },
];

function ImportScene() {
  return (
    <div className="be-illustration be-import-scene" aria-hidden="true">
      <div className="be-csv">
        <div className="be-file-head"><span className="be-file-icon">CSV</span><span>influencer-program.csv</span></div>
        <div className="be-csv-lines">
          <div className="be-csv-row"><span>Creator</span><span>Program</span></div>
          <div className="be-csv-row"><span>Ari Morgan</span><span>Style</span></div>
          <div className="be-csv-row"><span>Jules Lane</span><span>Video</span></div>
          <div className="be-csv-row"><span>Sage Kim</span><span>Beauty</span></div>
        </div>
      </div>
      <div className="be-transfer-column"><span /><b>→</b><small>IMPORT</small></div>
      <div className="be-roster">
        <div className="be-roster-head">Influencer roster <span>Imported</span></div>
        {roster.map((person) => (
          <div className="be-roster-row" key={person.initials}>
            <span className="be-initials">{person.initials}</span>
            <span className="be-roster-person">{person.name}<small>{person.role}</small></span>
            <span className="be-free">FREE ACCESS</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EcosystemScene() {
  return (
    <div className="be-illustration be-ecosystem-map" aria-hidden="true">
      <svg className="be-map-lines" viewBox="0 0 540 300" preserveAspectRatio="none" focusable="false">
        <defs>
          <marker id="be-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#688b68" />
          </marker>
        </defs>
        <path d="M270 78 C220 112 105 125 80 191" markerEnd="url(#be-arrowhead)" />
        <path d="M270 78 C270 125 270 139 270 202" markerEnd="url(#be-arrowhead)" />
        <path d="M270 78 C330 115 430 125 460 191" markerEnd="url(#be-arrowhead)" />
      </svg>
      <div className="be-library">
        <div className="be-library-top"><span>Global Content Library</span><span className="be-filter-pill">FILTERED · TRAVEL</span></div>
        <div className="be-library-clip"><span className="be-library-art" /><span><strong>Coastal escape</strong><small>Creator video · ready to share</small></span></div>
      </div>
      <div className="be-attribution-note">Reach paths keep attribution connected</div>
      <div className="be-map-node brand"><span className="be-node-mark">B</span><strong>Brand eCommerce</strong><small>Shoppable video · sales potential</small></div>
      <div className="be-map-node creator"><span className="be-node-mark">C</span><strong>Creator / Substack</strong><small>Creator affiliate attribution</small></div>
      <div className="be-map-node publisher"><span className="be-node-mark">P</span><strong>Travel Magazine</strong><small>Publisher commission</small></div>
      <div className="be-reach-note">Connected content · broader brand visibility</div>
    </div>
  );
}

function CommissionControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const scale = 1 + (value - 5) / 100;

  return (
    <div className="be-commission-panel">
      <h4>Creator commission</h4>
      <div className="be-commission-readout">
        <output htmlFor="be-commission-range" style={{ transform: `scale(${scale})` }}>{value}%</output>
      </div>
      <label className="be-sr-only" htmlFor="be-commission-range">Creator commission</label>
      <input
        id="be-commission-range"
        className="be-commission-range"
        type="range"
        min="5"
        max="35"
        step="1"
        value={value}
        aria-label="Creator commission, an illustrative demo control"
        aria-valuetext={`${value}% illustrative demo setting; no billing changes`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="be-slider-ends"><span>5%</span><span>35%</span></div>
      <p className="be-sr-only">Demonstration setting only. No account or billing changes.</p>
    </div>
  );
}

function DashboardScene({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="be-illustration be-dashboard-scene">
      <div className="be-metrics">
        <div className="be-metrics-head">Affiliate dashboard <span>OVERVIEW</span></div>
        <div className="be-metric-card"><small>Affiliate engagement</small><div className="be-engagement"><i /><i /><i /><span>Activity overview</span></div></div>
        <div className="be-metric-card"><small>Transaction value</small><strong className="be-zero">$0.00</strong></div>
      </div>
      <CommissionControl value={value} onChange={onChange} />
    </div>
  );
}

function SlideScene({
  index,
  commissionValue,
  onCommissionChange,
}: {
  index: number;
  commissionValue: number;
  onCommissionChange: (value: number) => void;
}) {
  switch (index) {
    case 0: return <RequestScene />;
    case 1: return <StorefrontScene />;
    case 2: return <SocialScene />;
    case 3: return <ImportScene />;
    case 4: return <EcosystemScene />;
    default: return <DashboardScene value={commissionValue} onChange={onCommissionChange} />;
  }
}

const includedFeatures = [
  "International merchant fees",
  "Video player customization",
  "Multi-publishing links",
  "Affiliate visibility",
  "Integrated influencer program",
  "Automatic sales payouts and purchase orders",
];

export function BrandEcosystemSection({ onUnlockTrial, embedded = false }: BrandEcosystemSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const typePositionRef = useRef(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [focusWithin, setFocusWithin] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [commissionValue, setCommissionValue] = useState(10);
  const [commissionManual, setCommissionManual] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [typed, setTyped] = useState("");
  const active = inView && documentVisible && !focusWithin && !manuallyPaused && !reducedMotion;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(query.matches);
    query.addEventListener?.("change", updateMotion);
    return () => query.removeEventListener?.("change", updateMotion);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setSlideIndex((current) => (current + 1) % slides.length), 6000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active || slideIndex !== 5 || commissionManual) return;
    const timer = window.setInterval(() => {
      setCommissionValue((value) => (value >= 35 ? 5 : value + 1));
    }, 320);
    return () => window.clearInterval(timer);
  }, [active, commissionManual, slideIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      const playback = video.play();
      if (playback && typeof playback.catch === "function") playback.catch(() => undefined);
    } else {
      video.pause();
    }
    return () => video.pause();
  }, [active]);

  useEffect(() => {
    typePositionRef.current = 0;
    setTyped("");
  }, [slideIndex]);

  useEffect(() => {
    if (reducedMotion) {
      setTyped(slides[slideIndex].title);
      return;
    }
    if (!active) return;
    let position = 0;
    const phrase = slides[slideIndex].title;
    const timer = window.setInterval(() => {
      position = Math.max(position, typePositionRef.current) + 1;
      typePositionRef.current = position;
      setTyped(phrase.slice(0, position));
      if (position >= phrase.length) window.clearInterval(timer);
    }, Math.min(28, 1150 / Math.max(phrase.length, 1)));
    return () => window.clearInterval(timer);
  }, [active, slideIndex, reducedMotion]);

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as HTMLElement | null;
    setFocusWithin(!!next && event.currentTarget.contains(next) && !next.closest("[data-testid='brand-ecosystem-pause']"));
  };

  return (
    <section
      ref={sectionRef}
      id="how-brands-grow"
      className="be-section"
      data-testid="brand-ecosystem-section"
      data-slide-index={slideIndex}
      data-paused={!active}
      aria-labelledby="be-section-title"
      onFocusCapture={(event) => setFocusWithin(!(event.target as HTMLElement).closest("[data-testid='brand-ecosystem-pause']"))}
      onBlurCapture={handleBlur}
    >
      <video
        ref={videoRef}
        className="be-video"
        muted
        loop
        playsInline
        preload="none"
        poster={homepageExplainerMedia.poster}
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src={homepageExplainerMedia.webm} type="video/webm" />
        <source src={homepageExplainerMedia.mp4} type="video/mp4" />
      </video>
      <div className="be-shell">
        <p className="be-kicker">MTRLZD video commerce marketplace</p>
        <div className="be-topline">
          <h2 className="be-title" id="be-section-title">In-video shopping, <em>built for brands.</em></h2>
          {!embedded && <span className="be-badge">Brand Demo</span>}
        </div>
        <div className="be-card">
          <span className="be-step-backdrop" aria-hidden="true">{slideIndex + 1}</span>
          <div className="be-copy">
            <h3 className="be-heading" key={`brand-heading-${slideIndex}`}>
              <span className="be-sr-only">{slides[slideIndex].title}</span>
              <span className="be-heading-visual" aria-hidden="true">{typed}</span>
            </h3>
            <p className="be-support">{slides[slideIndex].support}</p>
          </div>
          <div className="be-stage" key={`brand-scene-${slideIndex}`}>
            <div className="be-slide-enter">
              <SlideScene
                index={slideIndex}
                commissionValue={commissionValue}
                onCommissionChange={(value) => {
                  setCommissionManual(true);
                  setCommissionValue(value);
                }}
              />
            </div>
          </div>
        </div>
        <div className="be-bottom">
          <ol className="be-step-indicators" aria-label="Brand demo steps">
            {slides.map((_, index) => (
              <li key={index} aria-current={slideIndex === index ? "step" : undefined}>{index + 1}</li>
            ))}
          </ol>
          <div className="be-controls">
            {!reducedMotion && <button
              type="button"
              className="be-pause"
              data-testid="brand-ecosystem-pause"
              aria-pressed={manuallyPaused}
              onClick={() => setManuallyPaused((paused) => !paused)}
            >
              <span className={`be-pause-mark${manuallyPaused ? " is-play" : ""}`} aria-hidden="true" />
              {manuallyPaused ? "Resume" : "Pause"}
            </button>}
            <button type="button" className="be-cta" data-testid="brand-ecosystem-cta" onClick={onUnlockTrial}>
              Unlock FREE Trial
            </button>
          </div>
        </div>
        <aside className="be-fee" aria-label="Marketplace fee and included tools">
          <div className="be-fee-lead">
            <strong className="be-fee-percent">15%</strong>
            <p><b>Marketplace fee</b>for video commerce tools</p>
          </div>
          <ul className="be-fee-features">
            {includedFeatures.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        </aside>
        {reducedMotion && (
          <div className="be-reduced-summary">
            <h3>The complete brand story</h3>
            <ol>
              <li>A creator emails a shoppable-video invitation. The brand accepts, pays the $29 Admin Setup Fee, and finds the accepted video in My Campaigns.</li>
              <li>Preview the campaign, then paste the influencer’s video embed into eCommerce as a vertical player or a shoppable product thumbnail.</li>
              <li>Share a preview to Instagram and TikTok; tell your audience videos on your eCommerce are shoppable. Instagram Story includes a product carousel.</li>
              <li>Import an existing Influencer Program via CSV. Invited influencers get FREE access to Video Commerce tools.</li>
              <li>One library, more reach: the Global Content Library brings creator and publisher audiences to your brand. Creator affiliate attribution and publisher commission are preserved.</li>
              <li>Brand dashboard shows affiliate engagement and transaction value. Adjust influencer commission in-app.</li>
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

export default BrandEcosystemSection;
