import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // Check multiple possible build output directories
  const possiblePaths = [
    path.resolve(__dirname, "public"),
    path.resolve(__dirname, "..", "dist"),
    path.resolve(__dirname, "..", "client", "dist"),
  ];

  const distPath = possiblePaths.find(p => fs.existsSync(p));

  if (!distPath) {
    // In split deployment (frontend on Vercel), there's no static build.
    // Just serve the API — this is expected behavior.
    console.log("[Static] No build directory found — running in API-only mode (frontend served separately)");
    return;
  }

  app.use(express.static(distPath));

  // SPA fallback
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
