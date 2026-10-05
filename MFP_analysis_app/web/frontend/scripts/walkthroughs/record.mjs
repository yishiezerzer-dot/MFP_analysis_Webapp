// Records a guided-workflow walkthrough as PNG frames + frames.json; make_gif.py turns them into
// src/help/media/workflow-<name>.gif. Re-record when a workflow's screens change.
//
//   1. Run the backend (8000) and the frontend dev server on 5180, with the example files open
//      (Home → Try with example data on LCMS, FTIR and Plate Reader).
//   2. npm i --no-save playwright-core   (uses a Chromium from `npx playwright install chromium`,
//      or set CHROME to any Chrome/Chromium executable)
//   3. node scripts/walkthroughs/record.mjs mic|product|ftir|paper
//   4. python scripts/walkthroughs/make_gif.py src/help/media mic product ftir paper
//
// "mic" re-saves the example LacGlyDOH plate's layout (unchanged: every answer is read from it);
// "paper" stops at the summary, so nothing is downloaded.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME;
const BASE = "http://127.0.0.1:5180";
const which = process.argv[2];
const OUT = path.join(__dirname, "frames", which);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const frames = [];
let page;
let n = 0;

async function shot(caption, ms = 1800, click = null) {
  const file = path.join(OUT, `${String(n++).padStart(3, "0")}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, ms, caption, click });
}

async function click(locator, caption, ms = 1300) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await shot(caption, ms, [b.x + b.width / 2, b.y + b.height / 2]);
  await locator.click();
  // Park the mouse in an empty corner so no tooltip is left open.
  await page.mouse.move(1275, 4);
  await page.waitForTimeout(450);
}

async function scrollTo(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(700);
}

const dialog = () => page.getByRole("dialog");
const next = (caption) => click(dialog().getByRole("button", { name: "Next", exact: true }), caption ?? "Next");
const card = (title) => page.locator(".card", { has: page.getByRole("heading", { name: title }) });

const flows = {
  async mic() {
    await page.goto(`${BASE}/home`);
    await page.waitForTimeout(1500);
    await shot("Home: every task has a Guide me button", 2200);
    await click(card("Analyse a MIC plate").getByRole("button", { name: "Guide me" }), "Analyse a MIC plate → Guide me");
    await shot("Step 1: choose a plate you opened, or open a Gen5 export", 2200);
    await dialog().getByLabel("Plate", { exact: true }).selectOption({ label: "Example – LacGlyDOH 511 and 111.xlsx" });
    await page.waitForTimeout(400);
    await next("Plate chosen → Next");
    await shot("The compounds and their rows are read from the notes under the plate", 2600);
    await next();
    await shot("Dilution series: top concentration in column 1, ÷2 per column", 2200);
    await next();
    await shot("Growth control column and blank rows, also read from the plate", 2200);
    await next();
    await shot("Reference antibiotic: on this plate, on another plate, or none", 2200);
    await next();
    await shot("Check what it will do, then Run", 2600);
    await click(dialog().getByRole("button", { name: "Run" }), "Run");
    await page.waitForTimeout(3500);
    await shot("The plate is laid out and the Results tab shows % growth and the MIC", 3600);
  },

  async product() {
    await page.goto(`${BASE}/home`);
    await page.waitForTimeout(1500);
    await click(card("Find my product in an LCMS run").getByRole("button", { name: "Guide me" }), "Find my product → Guide me");
    await shot("Step 1: choose a run you opened, or open an mzML file", 2200);
    await dialog().getByLabel("Run", { exact: true }).selectOption({ label: "Example – PLGA oligomers.mzML" });
    await page.waitForTimeout(400);
    await next("Run chosen → Next");
    await shot("Step 2: the monomers your product is made of", 2000);
    await click(dialog().getByRole("button", { name: "GA · Glycolic acid" }), "Glycolic acid");
    await click(dialog().getByRole("button", { name: "LA · Lactic acid" }), "Lactic acid");
    await next();
    await shot("Step 3: the product's mass, if you know it", 1800);
    await dialog().getByPlaceholder("e.g. 206.0427").fill("148.0372");
    await shot("GA–LA dimer: 148.0372 Da", 1800);
    await next();
    await shot("Step 4: ionisation mode, adducts and charge states", 2400);
    await next();
    await shot("Check what it will do, then Run", 2800);
    await click(dialog().getByRole("button", { name: "Run" }), "Run");
    await page.waitForTimeout(6000);
    await scrollTo(page.getByText("Total Ion Chromatogram", { exact: true }).first());
    await shot("ESI+ on, chain labels on, and the spectrum loaded where the product is strongest (dashed line)", 3000);
    await scrollTo(page.getByText("EIC m/z 149.0445", { exact: false }).first());
    await shot("An EIC for each ion of the product shows when it elutes", 2800);
    await scrollTo(page.getByText("MS1 Spectrum", { exact: true }).first());
    await shot("The spectrum's peaks are labelled with their chain composition", 3800);
  },

  async ftir() {
    await page.goto(`${BASE}/home`);
    await page.waitForTimeout(1500);
    await click(card("Identify FTIR peaks").getByRole("button", { name: "Guide me" }), "Identify FTIR peaks → Guide me");
    await shot("Step 1: choose a spectrum you opened, or open a file", 2200);
    await dialog().getByLabel("Spectrum", { exact: true }).selectOption({ label: "Example – PLGA film.csv" });
    await page.waitForTimeout(400);
    await next("Spectrum chosen → Next");
    await shot("Step 2: how it was measured picks the clean-up", 2000);
    await click(dialog().getByText("Thin film — cast or pressed, measured in transmission"), "Thin film");
    await next();
    await shot("Step 3: rule out groups your sample cannot contain", 2000);
    for (const g of ["amide", "amine", "phosphate", "aromatic"]) await click(dialog().getByRole("button", { name: g, exact: true }), `Rule out ${g}`, 900);
    await next();
    await shot("Step 4: how many peaks to label", 2000);
    await click(dialog().getByText("The main peaks (up to 10)"), "The main peaks");
    await next();
    await shot("Check what it will do, then Run", 2600);
    await click(dialog().getByRole("button", { name: "Run" }), "Run");
    await page.waitForTimeout(5000);
    await shot("Peaks picked and labelled with the best-matching bonds", 3200);
    await scrollTo(page.getByText("Top candidate").first());
    await shot("The table lists each peak's candidates and scores", 3600);
  },

  async paper() {
    const runs = await (await fetch(`${BASE}/api/lcms/sessions`)).json();
    const example = runs.find((r) => r.display_name.startsWith("Example"));
    await page.goto(`${BASE}/lcms?open=${example.session_id}`);
    await page.waitForTimeout(4000);
    await click(page.locator('[data-control="app.experimentTag"] button').first(), "Open the experiment tag menu");
    await click(page.getByRole("button", { name: "Prepare for paper…" }), "Prepare for paper…");
    await shot("Step 1: figures from this page, the SI package, or both", 2600);
    await next();
    await shot("Step 2: the experiment the SI package is for", 2200);
    await next();
    await shot("Step 3: the journal's figure size and PNG resolution", 1800);
    await dialog().getByRole("combobox").first().selectOption({ label: "ACS Single Col (82.5 x 60 mm)" });
    await page.waitForTimeout(300);
    await next();
    await shot("Check what it will do; Run saves the charts (SVG + PNG) and the SI package", 4000);
  },
};

(async () => {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    for (const t of ["lcms", "ftir", "plate-reader", "ai"]) localStorage.setItem(`mfp.tour.offered.${t}`, "1");
  });
  page = await ctx.newPage();
  try {
    await flows[which]();
  } catch (err) {
    const text = await dialog().innerText().catch(() => "(no dialog)");
    console.error(`FAILED in ${which}: ${err.message}\nDialog: ${text}`);
    await page.screenshot({ path: path.join(OUT, "failure.png") });
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify(frames, null, 1));
    await browser.close();
  }
  console.log(`${which}: ${frames.length} frames`);
})();
