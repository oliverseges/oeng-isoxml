export interface MapPointHitTarget {
  recordIndex: number;
  x: number;
  y: number;
}

export type MapPointHitBuckets = Map<string, MapPointHitTarget[]>;

const DEFAULT_BUCKET_SIZE = 20;

function bucketKey(x: number, y: number, bucketSize: number): string {
  return `${Math.floor(x / bucketSize)}:${Math.floor(y / bucketSize)}`;
}

export function addMapPointHitTarget(
  buckets: MapPointHitBuckets,
  target: MapPointHitTarget,
  bucketSize = DEFAULT_BUCKET_SIZE,
): void {
  const key = bucketKey(target.x, target.y, bucketSize);
  const bucket = buckets.get(key);
  if (bucket) bucket.push(target);
  else buckets.set(key, [target]);
}

export function nearestMapPointIndex(
  buckets: MapPointHitBuckets,
  pointer: { x: number; y: number },
  radius = 10,
  bucketSize = DEFAULT_BUCKET_SIZE,
): number | undefined {
  const centerX = Math.floor(pointer.x / bucketSize);
  const centerY = Math.floor(pointer.y / bucketSize);
  const bucketRadius = Math.ceil(radius / bucketSize);
  let nearestIndex: number | undefined;
  let nearestDistance = radius * radius;

  for (let y = centerY - bucketRadius; y <= centerY + bucketRadius; y += 1) {
    for (let x = centerX - bucketRadius; x <= centerX + bucketRadius; x += 1) {
      for (const target of buckets.get(`${x}:${y}`) ?? []) {
        const deltaX = target.x - pointer.x;
        const deltaY = target.y - pointer.y;
        const distance = deltaX * deltaX + deltaY * deltaY;
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearestIndex = target.recordIndex;
        }
      }
    }
  }

  return nearestIndex;
}

export function displayedMapRecordIndex(
  hoveredRecordIndex: number | undefined,
  selectedRecordIndex: number | undefined,
): number | undefined {
  return hoveredRecordIndex ?? selectedRecordIndex;
}
