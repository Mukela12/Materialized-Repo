import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import CreatorEcosystemSection from "./CreatorEcosystemSection";
import BrandEcosystemSection from "./BrandEcosystemSection";
import "./marketplace-demo/MarketplaceDemoSection.css";

type MarketplaceDemoSectionProps = {
  onUnlockTrial: () => void;
};

type DemoTab = "creator" | "brand";

const tabs: { id: DemoTab; label: string; shortLabel: string }[] = [
  { id: "creator", label: "Creator Demo", shortLabel: "Creator" },
  { id: "brand", label: "Brand Demo", shortLabel: "Brand" },
];

export function MarketplaceDemoSection({ onUnlockTrial }: MarketplaceDemoSectionProps) {
  const [activeTab, setActiveTab] = useState<DemoTab>("creator");
  const tabRefs = useRef<Record<DemoTab, HTMLButtonElement | null>>({
    creator: null,
    brand: null,
  });

  const selectTab = (tab: DemoTab, moveFocus = false) => {
    setActiveTab(tab);
    if (moveFocus) tabRefs.current[tab]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    selectTab(tabs[nextIndex].id, true);
  };

  return (
    <section
      id="marketplace-demo"
      className={`marketplace-demo marketplace-demo--${activeTab}`}
      data-testid="marketplace-demo-section"
      aria-label="Marketplace product demos"
    >
      <div className="marketplace-demo__tabbar">
        <div className="marketplace-demo__tabs" role="tablist" aria-label="Choose a product demo">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              id={`marketplace-demo-tab-${tab.id}`}
              className={`marketplace-demo__tab${activeTab === tab.id ? " is-selected" : ""}`}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={activeTab === tab.id}
              aria-controls="marketplace-demo-panel"
              data-testid={`demo-tab-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={handleTabKeyDown}
            >
              <span className="marketplace-demo__tab-label">{tab.label}</span>
              <span className="marketplace-demo__tab-label-compact">{tab.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        id="marketplace-demo-panel"
        className="marketplace-demo__panel"
        role="tabpanel"
        aria-labelledby={`marketplace-demo-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === "creator" ? (
          <CreatorEcosystemSection onUnlockTrial={onUnlockTrial} embedded />
        ) : (
          <BrandEcosystemSection onUnlockTrial={onUnlockTrial} embedded />
        )}
      </div>
    </section>
  );
}
