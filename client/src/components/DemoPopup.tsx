import { useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const GIMBER_URL =
  "https://gimber.com/products/gimber-n1-original?srsltid=AfmBOoq8YJCyDbRKw7DA2emBhWw9FizzW0KQRz1sivyvGOxux9YhshCv";

const FORBURI_URL =
  "https://forburi.com/products/sequins-shirt?variant=45649179803838";

interface Props {
  open: boolean;
  onClose: () => void;
}

function GimberCard({ side }: { side: "bottom-right" | "bottom-left" }) {
  const positionStyle =
    side === "bottom-right"
      ? { bottom: 20, right: 20 }
      : { bottom: 20, left: 20 };

  return (
    <div className="absolute z-30" style={positionStyle}>
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <a
          href={GIMBER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block no-underline"
          style={{ width: "clamp(140px, 16vw, 180px)" }}
          data-testid={`link-gimber-card-${side}`}
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.52)",
              backdropFilter: "blur(14px)",
              border: "1px solid rgba(255,255,255,0.13)",
              boxShadow:
                "0 24px 60px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.06)",
            }}
          >
            <div className="p-3">
              <div
                className="w-full flex items-center justify-center overflow-hidden"
                style={{
                  height: 80,
                  borderRadius: 12,
                  background: "transparent",
                }}
              >
                <img
                  src="/gimber-original.png"
                  alt="Gimber Original"
                  className="h-full object-contain"
                  style={{ mixBlendMode: "multiply" }}
                />
              </div>
              <div className="mt-2 space-y-0.5">
                <div className="text-white/45 text-[7.5px] uppercase tracking-widest font-medium">
                  GIMBER
                </div>
                <div className="text-white text-[11px] font-semibold leading-tight">
                  Gimber Original
                </div>
                <div className="text-white font-bold text-sm leading-tight">
                  €27.95
                </div>
              </div>
              <div
                className="mt-2 w-full text-center text-[8px] font-black tracking-widest text-[#1a1a1a] py-2 rounded-xl"
                style={{ background: "rgba(255,255,255,0.92)" }}
              >
                ORDER NOW
              </div>
            </div>
          </div>
        </a>
      </motion.div>
    </div>
  );
}

function ForbúriCard() {
  return (
    <div className="absolute z-30" style={{ bottom: 20, left: 20 }}>
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <a
          href={FORBURI_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block no-underline"
          style={{ width: "clamp(140px, 16vw, 180px)" }}
          data-testid="link-forburi-card"
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.52)",
              backdropFilter: "blur(14px)",
              border: "1px solid rgba(255,255,255,0.13)",
              boxShadow:
                "0 24px 60px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.06)",
            }}
          >
            <div className="p-3">
              <div
                className="w-full flex items-center justify-center overflow-hidden"
                style={{
                  height: 80,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <img
                  src="/forburi-solstice.png"
                  alt="Forbúri Solstice Set"
                  className="h-full w-full object-cover"
                  style={{ borderRadius: 10 }}
                />
              </div>
              <div className="mt-2 space-y-0.5">
                <div className="text-white/45 text-[7.5px] uppercase tracking-widest font-medium">
                  FORBÚRI
                </div>
                <div className="text-white text-[11px] font-semibold leading-tight">
                  Solstice Set
                </div>
                <div className="text-white font-bold text-sm leading-tight">
                  €348
                </div>
              </div>
              <div
                className="mt-2 w-full text-center text-[8px] font-black tracking-widest text-[#1a1a1a] py-2 rounded-xl"
                style={{ background: "rgba(255,255,255,0.92)" }}
              >
                PRE ORDER
              </div>
            </div>
          </div>
        </a>
      </motion.div>
    </div>
  );
}

export function DemoPopup({ open, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (open) {
      const v = videoRef.current;
      if (v) {
        v.currentTime = 0;
        v.muted = false;
        v.play().catch(() => {
          v.muted = true;
          v.play();
        });
      }
    } else {
      videoRef.current?.pause();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCurrentTime(0);
      return;
    }
    const attach = () => {
      const v = videoRef.current;
      if (!v) return;
      const update = () => setCurrentTime(v.currentTime);
      v.addEventListener("timeupdate", update);
      return () => v.removeEventListener("timeupdate", update);
    };
    const cleanup = attach();
    return cleanup;
  }, [open]);

  const showBottomRight = currentTime >= 7 && currentTime <= 12;
  const showForburi = currentTime >= 19 && currentTime <= 30;
  const showBottomLeft = currentTime >= 49 && currentTime <= 62;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.82)" }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
          data-testid="demo-popup-overlay"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative w-full overflow-hidden"
            style={{
              maxWidth: "min(90vw, 1100px)",
              borderRadius: 20,
              border: "2px solid rgba(212,33,74,0.35)",
              boxShadow:
                "0 0 0 1px rgba(74,8,16,0.8), 0 40px 120px rgba(0,0,0,0.9)",
              background: "#2A0409",
            }}
            data-testid="demo-popup-container"
          >
            {/* Header bar — Croissant branding */}
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{
                background: "#470606",
                borderBottom: "1px solid rgba(212,33,74,0.25)",
              }}
            >
              <img
                src="/croissant-logo.png"
                alt="Croissant S'il Vous Plait"
                className="h-[200px] object-contain"
                data-testid="img-croissant-logo"
              />
              <button
                onClick={onClose}
                className="rounded-full p-1.5 transition-colors"
                style={{
                  background: "rgba(212,33,74,0.2)",
                  color: "#F0EBD8",
                  border: "1px solid rgba(212,33,74,0.3)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(212,33,74,0.4)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "rgba(212,33,74,0.2)")
                }
                data-testid="button-demo-close"
                aria-label="Close demo"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Video + carousels */}
            <div className="relative" style={{ aspectRatio: "16/9" }}>
              <video
                ref={videoRef}
                src="https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609780/materialized/public/croissant-demo.mp4"
                loop
                playsInline
                className="w-full h-full object-cover"
                data-testid="video-croissant-demo"
              />

              {/* Gimber carousel — bottom-right, seconds 7–12 */}
              <AnimatePresence>
                {showBottomRight && (
                  <motion.div
                    key="gimber-br"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.4 }}
                    className="absolute inset-0 pointer-events-none"
                  >
                    <div className="pointer-events-auto">
                      <GimberCard side="bottom-right" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Forbúri carousel — bottom-right, seconds 19–30 */}
              <AnimatePresence>
                {showForburi && (
                  <motion.div
                    key="forburi-br"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.4 }}
                    className="absolute inset-0 pointer-events-none"
                  >
                    <div className="pointer-events-auto">
                      <ForbúriCard />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Gimber carousel — bottom-left, seconds 49–62 */}
              <AnimatePresence>
                {showBottomLeft && (
                  <motion.div
                    key="gimber-bl"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.4 }}
                    className="absolute inset-0 pointer-events-none"
                  >
                    <div className="pointer-events-auto">
                      <GimberCard side="bottom-left" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer bar */}
            <div
              className="px-5 py-2.5 flex items-center gap-2"
              style={{
                background: "#470606",
                borderTop: "1px solid rgba(212,33,74,0.25)",
              }}
            >
              <div
                className="h-1.5 flex-1 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.1)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(currentTime / 62.88) * 100}%`,
                    background:
                      "linear-gradient(90deg, #D4214A, #FF6B8A)",
                  }}
                />
              </div>
              <span
                className="text-[11px] tabular-nums"
                style={{ color: "#F0EBD8" }}
              >
                {Math.floor(currentTime / 60)}:
                {String(Math.floor(currentTime % 60)).padStart(2, "0")}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
