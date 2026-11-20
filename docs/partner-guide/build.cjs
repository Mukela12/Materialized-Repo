/**
 * Builds the partner guide PDF from creator-platforms.html.
 *   PLAYWRIGHT=/path/to/node_modules/playwright node docs/partner-guide/build.cjs [out.pdf]
 * Playwright is not a dependency of the app, so its path is passed in.
 */
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
(async () => {
  const out = process.argv[2] || path.join(__dirname, "MTRLZD-Partner-Guide-Creator-Platforms.pdf");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "creator-platforms.html"));
  await page.evaluate(() => document.fonts.ready);
  // A page whose content runs past the sheet is clipped silently, so say so.
  const over = await page.evaluate(() => [...document.querySelectorAll(".page")].map((p, i) => {
    const foot = p.querySelector(".foot").getBoundingClientRect().top;
    const last = Math.max(...[...p.querySelectorAll(".body > *, .body .sec > *")].map((e) => e.getBoundingClientRect().bottom));
    return { page: i + 1, spare: Math.round(foot - last) };
  }));
  console.log(JSON.stringify(over));
  if (over.some((o) => o.spare < 8)) { console.error("A page is too full"); process.exitCode = 1; }
  await page.pdf({ path: out, format: "A4", printBackground: true });
  await browser.close();
  console.log("wrote", out);
})();
