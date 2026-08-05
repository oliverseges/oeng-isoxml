import { describe, expect, it } from "vitest";
import {
  addMapPointHitTarget,
  displayedMapRecordIndex,
  nearestMapPointIndex,
  type MapPointHitBuckets,
} from "@/components/viewer/map-hit-testing";

describe("map point hit testing", () => {
  it("finds only points within the hover radius", () => {
    const buckets: MapPointHitBuckets = new Map();
    addMapPointHitTarget(buckets, { recordIndex: 4, x: 100, y: 100 });
    addMapPointHitTarget(buckets, { recordIndex: 9, x: 119, y: 102 });

    expect(nearestMapPointIndex(buckets, { x: 121, y: 101 })).toBe(9);
    expect(nearestMapPointIndex(buckets, { x: 140, y: 140 })).toBeUndefined();
  });

  it("shows hovered details before a persistent click selection", () => {
    expect(displayedMapRecordIndex(12, 4)).toBe(12);
    expect(displayedMapRecordIndex(undefined, 4)).toBe(4);
  });
});
