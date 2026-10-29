// Post-deploy smoke test against the live site (runs in GitHub Actions after Pages deploys).
const { chromium } = require("playwright");
const URL0 = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Pages can take a moment to serve the new version
  for (let i = 0; i < 10; i++) {
    const res = await page.goto(URL0, { waitUntil: "load" });
    if (res && res.ok()) break;
    await page.waitForTimeout(6000);
  }
  await page.getByText("Get started").click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Load demo workouts to explore first").click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.waitForSelector("text=Morning check-in");
  for (const [tab, expect] of [["Plan", "Training plan"], ["Workouts", "Workouts"], ["Fuel", "Quick add"], ["Race", "Race-day plan:"], ["Me", "Thresholds & zones"]]) {
    await page.getByRole("navigation").getByRole("button", { name: tab }).click();
    await page.waitForSelector(`text=${expect}`, { timeout: 10000 });
    console.log(`ok: ${tab}`);
  }
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  console.log("service worker:", sw);
  console.log("manifest start_url:", manifest.start_url);
  await browser.close();
  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  if (!sw || !manifest.start_url) throw new Error("PWA not installable");
  console.log("LIVE SITE OK");
})().catch((e) => { console.error(e); process.exit(1); });
