import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { Product, Brand } from "@shared/schema";

export type CarouselPosition = "bottom" | "top" | "left" | "right" | "bottom-left" | "bottom-right" | "top-left" | "top-right";
export type ButtonLabel = "BUY NOW" | "PRE ORDER" | "RENT" | "ENQUIRE" | "APPLY NOW" | "DONATE" | "BOOK NOW" | "BID NOW";

export interface CarouselConfig {
  position: CarouselPosition;
  positionOffsetX: number;
  positionOffsetY: number;
  cornerRadius: number;
  backgroundOpacity: number;
  showThumbnail: boolean;
  showButton: boolean;
  showPrice: boolean;
  showTitle: boolean;
  buttonLabel: ButtonLabel;
  buttonColor: string;
  buttonTextColor: string;
  buttonFont?: string;
}

export interface DetectedProduct {
  id: string;
  productId: string;
  product: Product;
  brand?: Brand;
  confidence: number;
  startTime: number;
  endTime: number;
}

interface VideoProductCarouselProps {
  products: DetectedProduct[];
  config: CarouselConfig;
  currentTime: number;
  utmCode?: string;
  onProductClick?: (product: DetectedProduct) => void;
}

const defaultConfig: CarouselConfig = {
  position: "bottom",
  positionOffsetX: 0,
  positionOffsetY: 0,
  cornerRadius: 16,
  backgroundOpacity: 55,
  showThumbnail: true,
  showButton: true,
  showPrice: true,
  showTitle: true,
  buttonLabel: "BUY NOW",
  buttonColor: "#677A67",
  buttonTextColor: "#FFFFFF",
};

export function VideoProductCarousel({
  products,
  config = defaultConfig,
  currentTime,
  utmCode,
  onProductClick,
}: VideoProductCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleProducts = products.filter(
    (p) => currentTime >= p.startTime && currentTime <= p.endTime
  );

  useEffect(() => {
    if (visibleProducts.length > 0 && activeIndex >= visibleProducts.length) {
      setActiveIndex(0);
    }
  }, [visibleProducts.length, activeIndex]);

  const scrollToIndex = (index: number) => {
    if (scrollRef.current) {
      const child = scrollRef.current.children[index] as HTMLElement;
      if (child) {
        child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
    setActiveIndex(index);
  };

  const handlePrev = () => {
    const newIndex = activeIndex > 0 ? activeIndex - 1 : visibleProducts.length - 1;
    scrollToIndex(newIndex);
  };

  const handleNext = () => {
    const newIndex = activeIndex < visibleProducts.length - 1 ? activeIndex + 1 : 0;
    scrollToIndex(newIndex);
  };

  const handleProductClick = (product: DetectedProduct) => {
    if (onProductClick) {
      onProductClick(product);
    } else if (product.product.productUrl) {
      try {
        const baseUrl = product.product.productUrl.startsWith("http")
          ? product.product.productUrl
          : `${window.location.origin}${product.product.productUrl.startsWith("/") ? "" : "/"}${product.product.productUrl}`;
        const url = new URL(baseUrl);
        if (utmCode) {
          url.searchParams.set("utm_source", "video");
          url.searchParams.set("utm_medium", "carousel");
          url.searchParams.set("utm_campaign", utmCode);
        }
        window.open(url.toString(), "_blank");
      } catch {
        window.open(product.product.productUrl, "_blank");
      }
    }
  };

  const getPositionStyles = (): React.CSSProperties => {
    const offset = {
      x: config.positionOffsetX || 0,
      y: config.positionOffsetY || 0,
    };

    switch (config.position) {
      case "top":
        return { top: 16 + offset.y, left: "50%", transform: "translateX(-50%)" };
      case "bottom":
        return { bottom: 16 + offset.y, left: "50%", transform: "translateX(-50%)" };
      case "left":
        return { left: 16 + offset.x, top: "50%", transform: "translateY(-50%)" };
      case "right":
        return { right: 16 + offset.x, top: "50%", transform: "translateY(-50%)" };
      case "top-left":
        return { top: 16 + offset.y, left: 16 + offset.x };
      case "top-right":
        return { top: 16 + offset.y, right: 16 + offset.x };
      case "bottom-left":
        return { bottom: 16 + offset.y, left: 16 + offset.x };
      case "bottom-right":
        return { bottom: 16 + offset.y, right: 16 + offset.x };
      default:
        return { bottom: 16 + offset.y, left: "50%", transform: "translateX(-50%)" };
    }
  };

  const isVertical = config.position === "left" || config.position === "right";

  if (visibleProducts.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute z-30 max-w-full"
      style={{
        ...getPositionStyles(),
      }}
      data-testid="carousel-container"
    >
      <div
        className="flex items-center gap-2"
        style={{
          flexDirection: isVertical ? "column" : "row",
        }}
      >
        {visibleProducts.length > 1 && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 bg-black/40 hover:bg-black/60 text-white rounded-full"
            onClick={handlePrev}
            data-testid="button-carousel-prev"
          >
            {isVertical ? (
              <ChevronLeft className="h-4 w-4 rotate-90" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-hidden"
          style={{
            flexDirection: isVertical ? "column" : "row",
            maxWidth: isVertical ? "auto" : "min(400px, 80vw)",
            maxHeight: isVertical ? "min(400px, 60vh)" : "auto",
          }}
        >
          {visibleProducts.map((item, index) => (
            <Card
              key={item.id}
              className="shrink-0 cursor-pointer transition-all"
              style={{
                borderRadius: `${config.cornerRadius}px`,
                backdropFilter: "blur(8px)",
                width: isVertical ? "180px" : "auto",
                opacity: index === activeIndex ? 1 : 0.7,
                transform: index === activeIndex ? "scale(1)" : "scale(0.95)",
                backgroundColor: `hsl(var(--card) / ${config.backgroundOpacity / 100})`,
              }}
              onClick={() => handleProductClick(item)}
              data-testid={`card-product-${item.productId}`}
            >
              <div className="flex gap-3 p-3" style={{ flexDirection: isVertical ? "column" : "row" }}>
                {config.showThumbnail && item.product.imageUrl && (
                  <div
                    className="shrink-0 bg-muted flex items-center justify-center overflow-hidden"
                    style={{
                      borderRadius: `${Math.max(0, config.cornerRadius - 4)}px`,
                      width: isVertical ? "100%" : "60px",
                      height: isVertical ? "80px" : "60px",
                    }}
                  >
                    <img
                      src={item.product.imageUrl}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                  <div>
                    {item.brand && (
                      <Badge variant="secondary" className="mb-1 text-xs">
                        {item.brand.name}
                      </Badge>
                    )}
                    {config.showTitle && (
                      <p className="font-medium text-sm line-clamp-2" data-testid={`text-product-name-${item.productId}`}>
                        {item.product.name}
                      </p>
                    )}
                    {config.showPrice && item.product.price && (
                      <p className="text-sm font-semibold mt-1" data-testid={`text-product-price-${item.productId}`}>
                        ${Number(item.product.price).toFixed(2)}
                      </p>
                    )}
                  </div>

                  {config.showButton && (
                    <Button
                      size="sm"
                      className="w-full gap-1 text-xs rounded-full"
                      style={{
                        backgroundColor: config.buttonColor,
                        color: config.buttonTextColor,
                        fontFamily: config.buttonFont,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleProductClick(item);
                      }}
                      data-testid={`button-product-action-${item.productId}`}
                    >
                      {config.buttonLabel}
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {visibleProducts.length > 1 && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 bg-black/40 hover:bg-black/60 text-white rounded-full"
            onClick={handleNext}
            data-testid="button-carousel-next"
          >
            {isVertical ? (
              <ChevronRight className="h-4 w-4 rotate-90" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {visibleProducts.length > 1 && (
        <div
          className="flex justify-center gap-1.5 mt-2"
          style={{ flexDirection: isVertical ? "column" : "row" }}
        >
          {visibleProducts.map((_, index) => (
            <button
              key={index}
              className={`rounded-full transition-all ${
                index === activeIndex
                  ? "bg-white w-2 h-2"
                  : "bg-white/50 w-1.5 h-1.5"
              }`}
              onClick={() => scrollToIndex(index)}
              data-testid={`button-carousel-dot-${index}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
