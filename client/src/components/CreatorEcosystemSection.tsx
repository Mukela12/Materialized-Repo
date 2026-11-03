import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { homepageExplainerMedia } from "./homepage-explainer-media";
import "./creator-ecosystem/CreatorEcosystemSection.css";

type CreatorEcosystemSectionProps = { onUnlockTrial: () => void; embedded?: boolean };

const slides = [
  {
    title: "Your video starts here.",
    support: "Upload a creator video to MTRLZD. One clip starts the shoppable journey.",
  },
  {
    title: "Products, found in the frame.",
    support: "Tag a brand or invite one. AI scans products and matches them to that tagged brand’s inventory.",
  },
  {
    title: "Preview it. Then take it anywhere.",
    support: "Preview the shoppable video, share to Instagram Stories, or copy embed code.",
  },
  {
    title: "Your video. More destinations.",
    support: "Creators make the video; brands receive it for eCommerce, creators publish it on Substack.",
  },
  {
    title: "Your video travels further.",
    support: "Publishers repost your video, putting it in front of new audiences. More views, more follows, more income potential.",
  },
  {
    title: "Your video earns across audiences.",
    support: "Brands publish your video on their eCommerce. Their audience shops; you earn affiliate commission. Your attribution stays across every channel.",
  },
];

function UploadScene() {
  return (
    <div className="ce-illustration ce-upload-wrap" aria-hidden="true">
      <div className="ce-upload-card">
        <div className="ce-upload-heading"><span className="ce-upload-icon">↑</span><span><b>Upload to MTRLZD</b><small>Creator video · MP4</small></span></div>
        <div className="ce-upload-transfer">
          <div className="ce-video-file">
            <div className="ce-file-thumb"><img src="/paris-commerce-demo-poster.webp" alt="" /><span>▶ 00:18</span></div>
            <div className="ce-file-meta"><strong>studio-look-01.mp4</strong><small>18 sec · Video</small></div>
          </div>
          <div className="ce-upload-destination"><span className="ce-upload-destination-mark">M</span><span>MTRLZD<br /><small>Video library</small></span></div>
          <span className="ce-transfer-beam" />
        </div>
        <div className="ce-progress"><i /></div>
        <div className="ce-progress-meta"><span>Uploading creator video</span><span>Ready to tag</span></div>
      </div>
    </div>
  );
}

function MatchScene() {
  return (
    <div className="ce-illustration ce-match-scene" aria-hidden="true">
      <div className="ce-brand-actions">
        <span>Brand connection</span>
        <b>Tag brand</b>
        <b>Invite brand</b>
      </div>
      <div className="ce-scanner">
        <div className="ce-scan-frame">
          <img src="/paris-commerce-demo-poster.webp" alt="" />
          <span className="ce-scan-line" />
          <span className="ce-bounds" />
          <span className="ce-scan-caption">AI OBJECT DETECTION</span>
        </div>
        <span className="ce-scan-arrow">→</span>
        <div className="ce-inventory">
          <small>TAGGED BRAND · NOVA FORM</small>
          <div className="ce-product-match">
            <img src="/paris-commerce-demo-poster.webp" alt="" />
            <span><strong>Draped evening dress</strong><small>Matched from brand inventory</small></span>
          </div>
          <div className="ce-match">Product matched to NOVA FORM inventory</div>
        </div>
      </div>
    </div>
  );
}

function ShareScene() {
  return (
    <div className="ce-illustration ce-share-scene" aria-hidden="true">
      <div className="ce-story-preview" data-testid="creator-story-device">
        <div className="ce-story-top"><span className="ce-story-avatar">M</span><b>Your story</b><span>•••</span></div>
        <div className="ce-story-photo" data-testid="creator-story-viewport">
          <img src="/paris-commerce-demo-poster.webp" alt="" />
          <span className="ce-story-play">▶</span>
          <div className="ce-story-product"><small>SHOP THE LOOK</small><b>Draped evening dress</b><span>Buy Now</span></div>
        </div>
        <div className="ce-story-footer"><span>Shoppable video preview</span><b>Instagram Stories</b></div>
      </div>
      <div className="ce-embed-card">
        <span className="ce-embed-kicker">ALSO SHARE ON YOUR SITE</span>
        <strong>Embed this video</strong>
        <div className="ce-code">&lt;iframe src="mtrlzd.video"&gt;</div>
        <div className="ce-copy-action"><span className="ce-copy-before">Copy embed code <b>↗</b></span><span className="ce-copy-after"><i>✓</i> Copied</span></div>
      </div>
    </div>
  );
}

function ChannelsScene() {
  return (
    <div className="ce-illustration ce-channel-map" aria-hidden="true">
      <svg className="ce-channel-paths" viewBox="0 0 440 250" preserveAspectRatio="none">
        <defs><marker id="ce-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#a6baff" /></marker></defs>
        <path d="M145 125 C205 125 180 65 270 65" markerEnd="url(#ce-arrow)" />
        <path d="M145 125 C205 125 180 185 270 185" markerEnd="url(#ce-arrow)" />
      </svg>
      <div className="ce-channel-creator">
        <span className="ce-node-orb">01</span><strong>Creator</strong><small>Makes the video</small>
      </div>
      <div className="ce-channel-destination ce-channel-brand">
        <span className="ce-node-orb">02</span><strong>Brand eCommerce</strong><small>Receives shoppable video</small>
      </div>
      <div className="ce-channel-destination ce-channel-substack">
        <span className="ce-node-orb">03</span><strong>Substack</strong><small>Creator publishes video</small>
      </div>
    </div>
  );
}

function PublisherScene() {
  return (
    <div className="ce-illustration ce-publisher-scene" aria-hidden="true">
      <div className="ce-library-panel">
        <strong>Global Content Library</strong>
        <div className="ce-filter-options"><span>All</span><span className="ce-filter-selected">Travel <i /></span><span>Style</span></div>
        <div className="ce-travel-clip">
          <div className="ce-travel-art"><span className="ce-travel-sun" /><span className="ce-travel-mountain ce-mountain-back" /><span className="ce-travel-mountain ce-mountain-front" /><span className="ce-travel-play">▶</span></div>
          <span><b>Coastal drive</b><small>Travel video · 00:24</small></span>
        </div>
        <span className="ce-selected-label">Selected for repost</span>
      </div>
      <div className="ce-library-transfer"><span className="ce-transfer-track" /><i>↗</i><small>REPOST</small></div>
      <div className="ce-magazine">
        <div className="ce-magazine-travel"><span className="ce-travel-sun" /><span className="ce-travel-mountain ce-mountain-back" /><span className="ce-travel-mountain ce-mountain-front" /><span className="ce-magazine-play">▶</span></div>
        <div className="ce-mag-title">The Travel Edit</div>
        <div className="ce-mag-sub">Travel Magazine</div>
        <span className="ce-repost-badge">VIDEO REPOSTED</span>
      </div>
    </div>
  );
}

function AttributionScene() {
  return (
    <div className="ce-illustration ce-attribution" aria-hidden="true">
      <svg className="ce-growth-art" viewBox="0 0 480 260" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="ce-growth-stroke" x1="24" y1="235" x2="456" y2="26" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#d7ed81" />
            <stop offset="1" stopColor="#f6c475" />
          </linearGradient>
          <linearGradient id="ce-growth-wash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2d181" stopOpacity=".2" />
            <stop offset="1" stopColor="#c7dc7a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="ce-growth-area" d="M24 235 C84 230 104 207 151 207 S223 160 271 168 S347 112 383 104 S426 58 456 26 L456 248 L24 248 Z" />
        <path className="ce-growth-branch" d="M83 225 C126 216 137 197 171 185" />
        <path className="ce-growth-branch ce-growth-branch-late" d="M287 158 C324 145 338 120 366 107" />
        <path className="ce-growth-line" d="M24 235 C84 230 104 207 151 207 S223 160 271 168 S347 112 383 104 S426 58 456 26" />
        <circle className="ce-growth-point ce-growth-point-one" cx="24" cy="235" r="5" />
        <circle className="ce-growth-point ce-growth-point-two" cx="151" cy="207" r="5" />
        <circle className="ce-growth-point ce-growth-point-three" cx="271" cy="168" r="5" />
        <circle className="ce-growth-point ce-growth-point-four" cx="383" cy="104" r="5" />
        <circle className="ce-growth-point ce-growth-point-five" cx="456" cy="26" r="5" />
      </svg>
      <div className="ce-brand-publish-node"><b>Brand eCommerce</b><span>Publishes your video</span></div>
      <span className="ce-brand-flow-arrow" aria-hidden="true">↓</span>
      <div className="ce-shopper-source"><b>Brand’s consumer audience shops your video</b></div>
      <svg className="ce-attribution-paths" viewBox="0 0 440 86" preserveAspectRatio="none">
        <defs><marker id="ce-attribution-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#a6baff" /></marker></defs>
        <path d="M220 0 V28 C220 48 110 42 110 84" markerEnd="url(#ce-attribution-arrow)" />
        <path d="M220 0 V28 C220 48 330 42 330 84" markerEnd="url(#ce-attribution-arrow)" />
      </svg>
      <div className="ce-attrib-branches">
        <div className="ce-attrib-branch">
          <p className="ce-branch-title">Creator video + your audience</p>
          <div className="ce-commission">Creator affiliate commission</div>
          <div className="ce-commission">Brand sale</div>
        </div>
        <div className="ce-attrib-branch">
          <p className="ce-branch-title">Publisher repost path</p>
          <div className="ce-commission">Publisher commission</div>
          <div className="ce-commission">Creator affiliate attribution</div>
          <div className="ce-commission">Brand sale retained</div>
        </div>
      </div>
    </div>
  );
}

function SlideScene({ index }: { index: number }) {
  switch (index) {
    case 0: return <UploadScene />;
    case 1: return <MatchScene />;
    case 2: return <ShareScene />;
    case 3: return <ChannelsScene />;
    case 4: return <PublisherScene />;
    default: return <AttributionScene />;
  }
}

export function CreatorEcosystemSection({ onUnlockTrial, embedded = false }: CreatorEcosystemSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [focusWithin, setFocusWithin] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [typed, setTyped] = useState("");
  const typePositionRef = useRef(0);
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
    setFocusWithin(!!next && event.currentTarget.contains(next) && !next.closest("[data-testid='ecosystem-pause']"));
  };

  return (
    <section
      ref={sectionRef}
      id="how-mtrlzd-works"
      className="ce-section"
      data-testid="creator-ecosystem-section"
      data-slide-index={slideIndex}
      data-paused={!active}
      aria-labelledby="ce-section-title"
      onFocusCapture={(event) => setFocusWithin(!(event.target as HTMLElement).closest("[data-testid='ecosystem-pause']"))}
      onBlurCapture={handleBlur}
    >
      <video
        ref={videoRef}
        className="ce-video"
        data-testid="ecosystem-background"
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
      <div className="ce-shell">
        <p className="ce-kicker">Creator commerce, connected</p>
        <div className="ce-topline">
          <h2 className="ce-title" id="ce-section-title">From creator video to a <em>whole ecosystem.</em></h2>
          {!embedded && <span className="ce-demo-label">Creator demo</span>}
        </div>
        <div className="ce-card">
          <span className="ce-step-backdrop" aria-hidden="true">{slideIndex + 1}</span>
          <div className="ce-copy">
            <h3 className="ce-heading" key={`heading-${slideIndex}`}><span className="ce-sr-only">{slides[slideIndex].title}</span><span className="ce-heading-visual" aria-hidden="true">{typed}</span></h3>
            <p className="ce-support">{slides[slideIndex].support}</p>
          </div>
          <div className="ce-stage" key={`scene-${slideIndex}`}>
            <div className="ce-slide-enter"><SlideScene index={slideIndex} /></div>
          </div>
        </div>
        <div className="ce-bottom">
          <ol className="ce-step-indicators" aria-label="Explainer steps">
            {slides.map((_, index) => (
              <li key={index} aria-current={slideIndex === index ? "step" : undefined}>{index + 1}</li>
            ))}
          </ol>
          <div className="ce-controls">
            {!reducedMotion && (
              <button
                type="button"
                className="ce-pause"
                data-testid="ecosystem-pause"
                aria-pressed={manuallyPaused}
                onClick={() => setManuallyPaused((paused) => !paused)}
              >
                <span className={`ce-pause-mark${manuallyPaused ? " is-play" : ""}`} aria-hidden="true" />
                {manuallyPaused ? "Resume" : "Pause"}
              </button>
            )}
            <button type="button" className="ce-cta" data-testid="ecosystem-cta" onClick={onUnlockTrial}>
              Unlock FREE Trial
            </button>
          </div>
        </div>
        {reducedMotion && (
          <div className="ce-reduced-summary">
            <h3>The complete MTRLZD story</h3>
            <ol>
              <li>Creators upload videos to MTRLZD.</li>
              <li>Tag a brand or invite one; AI Object Detection identifies products and matches them to the tagged brand’s inventory.</li>
              <li>Preview the shoppable video, share to Instagram Stories, or copy embed code.</li>
              <li>Creators make videos; brands receive shoppable eCommerce video; creators publish to Substack.</li>
              <li>Publisher reposts can expand a creator’s audience and earning potential: more views, more follows, more income. A publisher filters the Global Content Library and reposts a selected Travel video into Travel Magazine.</li>
              <li>A brand publishes the creator’s video on its eCommerce; its audience shops it and the creator earns affiliate commission for the video. The creator’s own audience path remains; publisher reposts add publisher commission while creator attribution and the brand sale stay.</li>
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

export default CreatorEcosystemSection;
