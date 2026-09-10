import { zip as zipShapefile } from "@mapbox/shp-write";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function createTimeLogFixtureFiles(outputDir: string) {
  const taskDataPath = path.join(outputDir, "TASKDATA.XML");
  const headerPath = path.join(outputDir, "TLG00001.XML");
  const binaryPath = path.join(outputDir, "TLG00001.BIN");
  const bytes = new Uint8Array(21);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, 3_000, true);
  offset += 4;
  view.setUint16(offset, 15_000, true);
  offset += 2;
  view.setInt32(offset, 555_000_000, true);
  offset += 4;
  view.setInt32(offset, 102_500_000, true);
  offset += 4;
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 0);
  view.setInt32(offset, 42, true);

  const taskData = `<?xml version="1.0" encoding="UTF-8"?>
  <ISO11783_TaskData VersionMajor="4" VersionMinor="3">
    <DVC A="DVC1" B="Machine">
      <DET A="DET1" D="Working element"><DOR A="300"/></DET>
      <DPD A="300" B="008D"/>
    </DVC>
    <TSK A="TSK1" B="Executed task" G="4">
      <TLG A="TLG00001" B="21" C="1"/>
    </TSK>
  </ISO11783_TaskData>`;
  const header = `<?xml version="1.0" encoding="UTF-8"?>
  <TIM A="" D="4"><PTN A="" B="" D=""/><DLV A="008D" B="" C="DET1"/></TIM>`;

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(taskDataPath, taskData),
    writeFile(headerPath, header),
    writeFile(binaryPath, bytes),
  ]);

  return [taskDataPath, headerPath, binaryPath];
}

async function createBoundaryShapefileZip(outputPath: string) {
  const zipBytes = await zipShapefile<"nodebuffer">(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Overlay boundary" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [10.0, 55.0],
                [10.1, 55.0],
                [10.1, 55.1],
                [10.0, 55.1],
                [10.0, 55.0],
              ],
            ],
          },
        },
      ],
    },
    {
      compression: "DEFLATE",
      outputType: "nodebuffer",
      filename: "overlay-boundary",
      types: { polygon: "overlay-boundary" },
    },
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, zipBytes);
}

async function createBoundaryShapefileParts(outputDir: string) {
  const zipPath = path.join(outputDir, "loose-overlay-boundary.zip");
  await createBoundaryShapefileZip(zipPath);
  const archive = await JSZip.loadAsync(await readFile(zipPath));
  const files = await Promise.all(
    Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map(async (entry) => {
        const outputPath = path.join(outputDir, entry.name);
        await writeFile(outputPath, await entry.async("nodebuffer"));
        return outputPath;
      }),
  );
  return files;
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

test("switches the viewer language and persists it across reloads", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.locator('.viewer-shell[data-interactive="true"]'),
  ).toBeVisible();

  await page.getByLabel("Choose interface language").selectOption("de");
  await expect(page.getByText("Sprache")).toBeVisible();
  await expect(page.getByText("Variante erstellen")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Validierungsbericht öffnen/i }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("Variante erstellen")).toBeVisible();
});

test("offers CSV and shapefile exports for the active planned channel", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("treeitem", { name: /DDI 0001 · AcidLine S/i }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: "Export selected data channel",
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Export selected data channel as CSV" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: "Export selected data channel as GeoJSON",
    }),
  ).toBeVisible();

  const csvDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export selected data channel as CSV" })
    .click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/GRD00001-0001-PDT1\.csv/);

  await page
    .getByRole("button", {
      name: "Export selected data channel",
    })
    .click();
  const geoJsonDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export selected data channel as GeoJSON" })
    .click();
  const geoJsonDownload = await geoJsonDownloadPromise;
  expect(geoJsonDownload.suggestedFilename()).toMatch(
    /GRD00001-0001-PDT1\.geojson/,
  );

  await page
    .getByRole("button", {
      name: "Export selected data channel",
    })
    .click();
  const shapeDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Export selected data channel as Shapefile",
    })
    .click();
  const shapeDownload = await shapeDownloadPromise;
  expect(shapeDownload.suggestedFilename()).toMatch(/GRD00001-0001-PDT1\.zip/);
});

test("offers CSV, GeoJSON and shapefile exports for an executed channel", async ({
  page,
}, testInfo) => {
  const fixtureFiles = await createTimeLogFixtureFiles(
    testInfo.outputPath("timelog-fixture"),
  );

  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(fixtureFiles);
  await expect(page.getByText("Selected ISOXML files").first()).toBeVisible();
  await expect(page.getByText("Executed task").first()).toBeVisible();

  await page
    .getByRole("button", {
      name: "Export selected data channel",
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Export selected data channel as CSV" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: "Export selected data channel as GeoJSON",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: "Export selected data channel as Shapefile",
    }),
  ).toBeVisible();

  const csvDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export selected data channel as CSV" })
    .click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/TLG00001-008D-DET1\.csv/);

  await page
    .getByRole("button", {
      name: "Export selected data channel",
    })
    .click();
  const geoJsonDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export selected data channel as GeoJSON" })
    .click();
  const geoJsonDownload = await geoJsonDownloadPromise;
  expect(geoJsonDownload.suggestedFilename()).toMatch(
    /TLG00001-008D-DET1\.geojson/,
  );

  await page
    .getByRole("button", {
      name: "Export selected data channel",
    })
    .click();
  const shapeDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Export selected data channel as Shapefile",
    })
    .click();
  const shapeDownload = await shapeDownloadPromise;
  expect(shapeDownload.suggestedFilename()).toMatch(/TLG00001-008D-DET1\.zip/);
});

test("imports a zipped shapefile as a boundary overlay on the current dataset", async ({
  page,
}, testInfo) => {
  const shapefileZip = testInfo.outputPath("overlay-boundary.zip");
  await createBoundaryShapefileZip(shapefileZip);

  await page.goto("/");
  await expect(
    page.getByRole("treeitem", { name: /DDI 0001 · AcidLine S/i }),
  ).toBeVisible();

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([shapefileZip]);
  const boundaryOverlay = page.getByRole("treeitem", {
    name: /Overlay boundary.*points/i,
  });
  await expect(boundaryOverlay).toBeVisible();
  await boundaryOverlay.click();
  await expect(boundaryOverlay).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByText("overlay-boundary.zip").first()).toBeVisible();
  await page.getByRole("tab", { name: /Issues/i }).click();
  await expect(
    page.getByText(/Imported shapefile boundary overlay Overlay boundary/i),
  ).toBeVisible();
});

test("imports loose shapefile sidecar files as a boundary overlay", async ({
  page,
}, testInfo) => {
  const shapefileParts = await createBoundaryShapefileParts(
    testInfo.outputPath("loose-boundary"),
  );

  await page.goto("/");
  await expect(
    page.getByRole("treeitem", { name: /DDI 0001 · AcidLine S/i }),
  ).toBeVisible();

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(shapefileParts);
  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByText("overlay-boundary.zip").first()).toBeVisible();
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
