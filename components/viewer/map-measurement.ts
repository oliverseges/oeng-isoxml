import type { Map as LeafletMap } from "leaflet";
import type { I18n } from "@/lib/client/i18n";
import {
  geographicDistanceMeters,
  type GeographicPoint,
} from "@/lib/isoxml/spatial";

export type MeasurementPoint = GeographicPoint;

export function formatMeasurementDistance(
  distanceMeters: number,
  i18n: I18n,
): string {
  const maximumFractionDigits = distanceMeters < 100 ? 1 : 0;
  return `${i18n.formatNumber(distanceMeters, { maximumFractionDigits })} m`;
}

export function drawMeasurementOverlay(
  context: CanvasRenderingContext2D,
  map: LeafletMap,
  points: MeasurementPoint[],
  i18n: I18n,
): void {
  if (!points.length) return;

  const projected = points.map((point) =>
    map.latLngToContainerPoint([point.latitude, point.longitude]),
  );

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (projected.length > 1) {
    context.beginPath();
    projected.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = "rgba(247, 194, 76, 0.96)";
    context.lineWidth = 2.5;
    context.setLineDash([7, 5]);
    context.stroke();
    context.setLineDash([]);

    for (let index = 1; index < projected.length; index += 1) {
      const start = projected[index - 1];
      const end = projected[index];
      const label = formatMeasurementDistance(
        geographicDistanceMeters(points[index - 1], points[index]),
        i18n,
      );
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      context.font = '9px Consolas, "SFMono-Regular", monospace';
      const width = context.measureText(label).width + 10;
      context.fillStyle = "rgba(8, 12, 10, 0.86)";
      context.fillRect(midX - width / 2, midY - 9, width, 18);
      context.strokeStyle = "rgba(247, 194, 76, 0.46)";
      context.lineWidth = 1;
      context.strokeRect(midX - width / 2 + 0.5, midY - 8.5, width - 1, 17);
      context.fillStyle = "#f6ddb2";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, midX, midY + 0.5);
    }
  }

  projected.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    context.fillStyle = index === projected.length - 1 ? "#f7c24c" : "#c7d955";
    context.fill();
    context.strokeStyle = "#081210";
    context.lineWidth = 1.5;
    context.stroke();
  });

  context.restore();
}