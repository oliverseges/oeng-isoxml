import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://www.isobus.net";
const LIST_URL = `${BASE_URL}/isobus/dDEntity/index`;
const PAGE_COUNT = 8;
const CONCURRENCY = 4;
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../lib/isoxml/data/isobus-ddi.json",
);
const CORE_OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../lib/isoxml/data/isobus-ddi-core.json",
);

const units = [
  { id: -1, name: "not defined", symbol: "not defined" },
  { id: 1, name: "Length", symbol: "mm" },
  { id: 2, name: "Speed", symbol: "mm/s" },
  { id: 3, name: "Area", symbol: "m²" },
  { id: 4, name: "Area per time unit", symbol: "mm²/s" },
  { id: 6, name: "Capacity per area unit", symbol: "mm³/m²" },
  { id: 7, name: "Capacity per capacity unit", symbol: "mm³/m³" },
  { id: 8, name: "Capacity per mass unit", symbol: "mm³/kg" },
  { id: 9, name: "Flow", symbol: "mm³/s" },
  { id: 10, name: "Milli Siemens per meter", symbol: "mS/m" },
  { id: 12, name: "Mass per area unit", symbol: "mg/m²" },
  { id: 13, name: "Mass per capacity unit", symbol: "mg/l" },
  { id: 14, name: "Mass per mass unit", symbol: "mg/kg" },
  { id: 15, name: "Mass flow", symbol: "mg/s" },
  { id: 18, name: "1000 seed Mass", symbol: "mg/1000" },
  { id: 19, name: "Electrical resistance", symbol: "Ohm" },
  { id: 21, name: "Electrical energy", symbol: "kWh" },
  { id: 22, name: "Electrical Power", symbol: "W" },
  { id: 23, name: "Electrical energy per area", symbol: "kWh/m²" },
  { id: 24, name: "Pressure", symbol: "Pa" },
  { id: 25, name: "Time", symbol: "ms" },
  { id: 26, name: "Electrical frequency", symbol: "Hz" },
  { id: 27, name: "Quantity per time unit", symbol: "/s" },
  { id: 28, name: "Electrical current", symbol: "A" },
  { id: 30, name: "Temperature", symbol: "mK" },
  { id: 31, name: "Quantity/Count", symbol: "#" },
  { id: 33, name: "Quantity per area unit", symbol: "/m²" },
  { id: 34, name: "Quantity per mass unit", symbol: "/mg" },
  { id: 39, name: "Quantity per volume", symbol: "L" },
  { id: 40, name: "Mass", symbol: "kg" },
  { id: 41, name: "Distance", symbol: "m" },
  { id: 42, name: "Hour", symbol: "h" },
  { id: 43, name: "Volume per distance", symbol: "ml/m" },
  { id: 133, name: "Capacity count", symbol: "L" },
  { id: 147, name: "Newton", symbol: "N" },
  { id: 148, name: "Newton metre", symbol: "N*m" },
  { id: 153, name: "Time count", symbol: "s" },
  { id: 156, name: "Electrical voltage", symbol: "V" },
  { id: 200, name: "Capacity large", symbol: "ml" },
  { id: 201, name: "Mass large", symbol: "g" },
  { id: 202, name: "Capacity per area large", symbol: "ml/m²" },
  { id: 203, name: "Float large", symbol: "ml/s" },
  { id: 204, name: "Volume per quantity unit", symbol: "ml/1000" },
  { id: 205, name: "Parts per million", symbol: "ppm" },
  { id: 206, name: "Percent", symbol: "%" },
  { id: 208, name: "Angle", symbol: "°" },
  { id: 209, name: "", symbol: "n.a." },
  { id: 210, name: "Revolutions per minute", symbol: "r/min" },
  { id: 211, name: "Mass per hour unit", symbol: "kg/h" },
];

const deviceClassNames = [
  "Non-specific system",
  "Tractor",
  "Primary Soil Tillage",
  "Secondary Soil Tillage",
  "Planters /Seeders",
  "Fertilizer",
  "Sprayers",
  "Harvesters",
  "Root Harvester",
  "Forage harvester",
  "Irrigation",
  "Transport / Trailers",
  "Farmyard Work",
  "Powered Auxilary Units",
  "Special Crops",
  "Municipal Work",
  "Skidders",
  "Sensor System",
  "Reserved for Future Assignment",
  "Timber Harvesters",
  "Forwarders",
  "Timber loaders",
  "Timber Processing Machines",
  "Mulchers",
  "Utility Vehicles",
  "Slurry Applicators",
  "Feeder / Mixer",
  "Weeders",
];

const deviceClasses = [
  { id: -1, name: "Not Assigned" },
  ...deviceClassNames.map((name, id) => ({ id, name })),
];

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    deg: "°",
    gt: ">",
    lt: "<",
    middot: "·",
    nbsp: " ",
    quot: '"',
    sup2: "²",
    sup3: "³",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z0-9]+);/gi, (match, entity) => named[entity] ?? match);
}

function plainText(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function fetchHtml(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "OENG-ISOXML-Studio-DDI-Sync/1.0",
    },
  });
  const html = await response.text();
  const blocked =
    !response.ok ||
    html.includes("Please wait while your request is being verified") ||
    html.includes("One moment, please");
  if (!blocked) return html;
  if (attempt >= 6) {
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  }
  await new Promise((resolveDelay) =>
    setTimeout(resolveDelay, attempt * attempt * 750),
  );
  return fetchHtml(url, attempt + 1);
}

function listingEntries(html) {
  return [
    ...html.matchAll(
      /<a href="\/isobus\/dDEntity\/(\d+)">\s*(\d+)\s*-\s*([^<]+)<\/a>/g,
    ),
  ].map((match) => ({
    recordId: Number(match[1]),
    ddi: Number(match[2]),
    name: plainText(match[3]),
  }));
}

function detailRows(html) {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = rowMatch[1].match(
      /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
    );
    if (cells) rows.push([plainText(cells[1]), plainText(cells[2])]);
  }
  return new Map(rows);
}

function deviceClassIds(html) {
  const match = html.match(
    /Typically used by Device Class\(es\)[\s\S]*?<td>([\s\S]*?)<\/td>/i,
  );
  if (!match) return [];
  return [...match[1].matchAll(/(\d+)\s*-\s*[^<]*<br\s*\/?>/gi)].map((item) =>
    Number(item[1]),
  );
}

function nullable(value) {
  return !value || value === "Not set" || value === "not specified"
    ? null
    : value;
}

function parseDetail(listingEntry, html, version) {
  const title = html.match(
    /Details for DDEntity\s*&quot;(\d+)\s*-\s*([^&]+)&quot;|Details for DDEntity\s*"(\d+)\s*-\s*([^"]+)"/i,
  );
  const rows = detailRows(html);
  const detailDdi = Number(title?.[1] ?? title?.[3]);
  if (!Number.isFinite(detailDdi) || detailDdi !== listingEntry.ddi) {
    throw new Error(
      `Record ${listingEntry.recordId} returned DDI ${detailDdi || "unknown"}; expected ${listingEntry.ddi}.`,
    );
  }
  const rawUnit = rows.get("Unit Symbol") ?? "";
  return {
    ddi: listingEntry.ddi,
    recordId: listingEntry.recordId,
    name: plainText(title?.[2] ?? title?.[4] ?? listingEntry.name),
    definition: nullable(rows.get("Definition")),
    comment: nullable(rows.get("Comment")),
    deviceClasses: deviceClassIds(html),
    unitSymbol: nullable(rawUnit.replace(/\s+-\s*$/, "").trim()),
    bitResolution: nullable(rows.get("Bit Resolution")),
    canBusRange: nullable(rows.get("CANBus Range")),
    displayRange: nullable(rows.get("Display Range")),
    status: nullable(rows.get("Current Status")),
    revision: nullable(rows.get("Revision Number")),
    sourceUrl: `${BASE_URL}/isobus/dDEntity/${listingEntry.recordId}`,
    sourceVersion: version,
  };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
      completed += 1;
      if (completed % 50 === 0 || completed === items.length) {
        console.log(`Fetched ${completed}/${items.length} DDI detail pages`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  console.log("Fetching the eight ISOBUS DDI listing pages");
  const listingPages = [];
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    listingPages.push(
      await fetchHtml(
        `${LIST_URL}${page === 1 ? "" : `?DDEntity_page=${page}`}`,
      ),
    );
  }
  const version = listingPages[0].match(/Version:\s*(\d+)/i)?.[1] ?? "unknown";
  const byDdi = new Map();
  listingPages.flatMap(listingEntries).forEach((entry) => {
    byDdi.set(entry.ddi, entry);
  });
  const listings = [...byDdi.values()].sort(
    (left, right) => left.ddi - right.ddi,
  );
  if (listings.length !== 765) {
    throw new Error(`Expected 765 DDI entries; found ${listings.length}.`);
  }
  console.log(`Discovered ${listings.length} DDIs in dictionary ${version}`);
  const entries = await mapConcurrent(listings, CONCURRENCY, async (entry) =>
    parseDetail(
      entry,
      await fetchHtml(`${BASE_URL}/isobus/dDEntity/${entry.recordId}`),
      version,
    ),
  );
  const entryFields = [
    "ddi",
    "recordId",
    "name",
    "definition",
    "comment",
    "deviceClasses",
    "unitSymbol",
    "bitResolution",
    "canBusRange",
    "displayRange",
    "status",
    "revision",
  ];
  const compactEntries = entries.map((entry) => [
    entry.ddi,
    entry.recordId,
    entry.name,
    entry.definition,
    entry.comment,
    entry.deviceClasses,
    entry.unitSymbol,
    entry.bitResolution,
    entry.canBusRange,
    entry.displayRange,
    entry.status,
    entry.revision,
  ]);
  const payload = {
    source: LIST_URL,
    version,
    entryFields,
    entries: compactEntries,
    units,
    deviceClasses,
  };
  const corePayload = {
    source: LIST_URL,
    version,
    entries: entries.map((entry) => [entry.ddi, entry.recordId, entry.name]),
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await Promise.all([
    writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    writeFile(
      CORE_OUTPUT_PATH,
      `${JSON.stringify(corePayload, null, 2)}\n`,
      "utf8",
    ),
  ]);
  console.log(`Wrote ${entries.length} entries to ${OUTPUT_PATH}`);
  console.log(`Wrote the lightweight index to ${CORE_OUTPUT_PATH}`);
}

await main();
