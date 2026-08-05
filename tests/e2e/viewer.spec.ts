import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const fixtureRoot = fileURLToPath(
  new URL("../../public/demo/", import.meta.url),
);

async function createFixtureZip(outputPath: string) {
  const zip = new JSZip();
  const [taskData, gridData] = await Promise.all([
    readFile(path.join(fixtureRoot, "TASKDATA.XML")),
    readFile(path.join(fixtureRoot, "GRD00001.BIN")),
  ]);
  zip.file("TASKDATA.XML", taskData);
  zip.file("GRD00001.BIN", gridData);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
}

test("selects repeated-DDI products independently and traces a cell to bytes", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("treeitem", { name: /DDI 0001 · AcidLine S/i }),
  ).toBeVisible();
  const baseGrow = page.getByRole("treeitem", {
    name: /DDI 0001 · BaseGrow N/i,
  });
  await expect(baseGrow).toBeVisible();
  await baseGrow.click();

  await expect(page.getByRole("heading", { name: "BaseGrow N" })).toBeVisible();
  await expect(
    page.getByText(/DDI 0001 · Setpoint Volume Per Area/).first(),
  ).toBeVisible();

  const map = page.getByTestId("isoxml-map");
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  await map.click({
    position: {
      x: Math.round((box?.width ?? 600) * 0.49),
      y: Math.round((box?.height ?? 400) * 0.52),
    },
  });
  await expect(page.locator(".map-coordinate-pin")).toHaveCount(0);
  await expect(page.locator(".map-coordinate.selected")).toBeVisible();
  await page.getByTitle("Copy selected cell coordinate").click();

  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.getByText("Byte offset")).toBeVisible();
  await expect(page.getByText("INT32 LE")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open full source panel/i }),
  ).toBeVisible();
});

test("imports selected XML and binary files locally", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("North field · variable-rate trial").first(),
  ).toBeVisible();

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      path.join(fixtureRoot, "TASKDATA.XML"),
      path.join(fixtureRoot, "GRD00001.BIN"),
    ]);

  await expect(page.getByText("Selected ISOXML files").first()).toBeVisible();
  await expect(page.getByText("48 CELLS").first()).toBeVisible();
  await expect(page.getByText(/local only/i)).toBeVisible();
});

test("keeps multiple ZIP imports separate and restores the recent dataset menu", async ({
  page,
}, testInfo) => {
  const firstZip = testInfo.outputPath("package-a.zip");
  const secondZip = testInfo.outputPath("package-b.zip");
  await Promise.all([createFixtureZip(firstZip), createFixtureZip(secondZip)]);

  await page.goto("/");
  await expect(
    page.locator('.viewer-shell[data-interactive="true"]'),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([firstZip, secondZip]);

  const dialog = page.getByRole("dialog", {
    name: "How should 2 packages be imported?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Separate imports remain available");
  await dialog.getByRole("button", { name: "Import separately" }).click();

  const switcher = page.getByRole("button", {
    name: /package-b\.zip.*North field/i,
  });
  await expect(switcher).toBeVisible();
  await switcher.click();
  const firstMenuItem = page
    .getByRole("menuitem")
    .filter({ hasText: "package-a.zip" });
  await expect(firstMenuItem).toBeVisible();
  await expect(
    page.getByRole("menuitem").filter({ hasText: "package-b.zip" }),
  ).toBeVisible();
  await firstMenuItem.click();
  await expect(
    page.getByRole("button", { name: /package-a\.zip.*North field/i }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("button", { name: /package-b\.zip.*North field/i }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /package-b\.zip.*North field/i })
    .click();
  await expect(
    page.getByRole("menuitem").filter({ hasText: "package-a.zip" }),
  ).toBeVisible();
});

test("can deliberately merge multiple ZIP packages into one dataset", async ({
  page,
}, testInfo) => {
  const firstZip = testInfo.outputPath("merge-a.zip");
  const secondZip = testInfo.outputPath("merge-b.zip");
  await Promise.all([createFixtureZip(firstZip), createFixtureZip(secondZip)]);

  await page.goto("/");
  await expect(
    page.locator('.viewer-shell[data-interactive="true"]'),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([firstZip, secondZip]);
  await page
    .getByRole("dialog", { name: "How should 2 packages be imported?" })
    .getByRole("button", { name: "Combine in one workspace" })
    .click();

  await expect(
    page.getByRole("button", {
      name: /Merged 2 ISOXML packages.*2 tasks/i,
    }),
  ).toBeVisible();
});

test("uses one import control and keeps its label legible in light mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.locator('.viewer-shell[data-interactive="true"]'),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Folder" })).toHaveCount(0);
  await expect(page.locator(".privacy-marker")).toHaveCount(0);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByRole("button", { name: "Import" })).toHaveCSS(
    "color",
    "rgb(247, 250, 243)",
  );
});

test("exports the active decoded channel as CSV", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("treeitem", { name: /DDI 0001 · AcidLine S/i }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Export selected data channel as CSV",
    })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/GRD00001-0001-PDT1\.csv/);
});

test("opens both workspace drawers at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open dataset navigator" }).click();
  await expect(
    page.getByRole("heading", { name: "Dataset navigator" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse dataset navigator" })
    .click();

  await page.getByRole("button", { name: "Open object inspector" }).click();
  await expect(page.getByText("Pinned selection").first()).toBeVisible();
});
