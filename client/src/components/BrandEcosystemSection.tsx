import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { homepageExplainerMedia } from "./homepage-explainer-media";
import "./brand-ecosystem/BrandEcosystemSection.css";
import { ImportScene, LibraryScene, SocialScene, StorefrontScene, preloadBrandDemoMedia } from "./brand-ecosystem/BrandDemoScenes";

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
    support: "Your audience taps the product in your Story and shops the video on your eCommerce.",
  },
  {
    title: "Bring your influencer program with you.",
    support: "Import your existing program from CSV. Invited influencers get FREE access to Video Commerce tools.",
  },
  {
    title: "Global content library. Accelerate your sales.",
    support: "Find creator videos by category and publish them to your eCommerce. Brands, creators and publishers each earn from the sales.",
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
  active,
  reducedMotion,
  commissionValue,
  onCommissionChange,
}: {
  index: number;
  active: boolean;
  reducedMotion: boolean;
  commissionValue: number;
  onCommissionChange: (value: number) => void;
}) {
  switch (index) {
    case 0: return <RequestScene />;
    case 1: return <StorefrontScene active={active} reducedMotion={reducedMotion} />;
    case 2: return <SocialScene active={active} reducedMotion={reducedMotion} />;
    case 3: return <ImportScene active={active} reducedMotion={reducedMotion} />;
    case 4: return <LibraryScene active={active} reducedMotion={reducedMotion} />;
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
    if (inView) preloadBrandDemoMedia();
  }, [inView]);

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
                active={active}
                reducedMotion={reducedMotion}
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
              <li>Paste the influencer’s video embed into your eCommerce product page as a vertical player or a shoppable product thumbnail.</li>
              <li>Share your interactive video previews to Instagram and TikTok. Your audience taps the product in your Story and shops the video on your eCommerce.</li>
              <li>Import your existing influencer program from CSV and see each creator’s category, videos, views and sales. Invited influencers get FREE access to Video Commerce tools.</li>
              <li>Filter the Global Content Library by category, such as Travel, and publish a creator’s video to your eCommerce. The brand earns from the sales, the creator earns affiliate commission and the publisher earns publisher commission.</li>
              <li>Brand dashboard shows affiliate engagement and transaction value. Adjust influencer commission in-app.</li>
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

export default BrandEcosystemSection;
