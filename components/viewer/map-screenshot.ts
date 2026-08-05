interface MapScreenshotTooltipRow {
  label: string;
  value: string;
}

interface MapScreenshotTooltipOptions {
  anchor: { x: number; y: number };
  headerLabel: string;
  headerValue: string;
  formattedValue: string;
  unit?: string;
  rows: MapScreenshotTooltipRow[];
}

function fittedText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (context.measureText(value).width <= maxWidth) return value;
  let fitted = value;
  while (
    fitted.length > 1 &&
    context.measureText(`${fitted}…`).width > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}…`;
}

export function drawMapScreenshotTooltip(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: MapScreenshotTooltipOptions,
): void {
  const margin = 12;
  const gap = 14;
  const panelWidth = Math.min(190, Math.max(120, width - margin * 2));
  const panelHeight = 76 + options.rows.length * 18;
  let x = options.anchor.x + gap;
  let y = options.anchor.y + gap;

  if (x + panelWidth > width - margin) {
    x = options.anchor.x - panelWidth - gap;
  }
  if (y + panelHeight > height - margin) {
    y = options.anchor.y - panelHeight - gap;
  }
  x = Math.max(margin, Math.min(x, width - panelWidth - margin));
  y = Math.max(margin, Math.min(y, height - panelHeight - margin));

  const innerX = x + 11;
  const innerWidth = panelWidth - 22;
  context.save();
  context.globalAlpha = 1;
  context.fillStyle = "rgba(7, 16, 13, 0.94)";
  context.fillRect(x, y, panelWidth, panelHeight);
  context.strokeStyle = "rgba(197, 214, 204, 0.28)";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, panelWidth - 1, panelHeight - 1);

  context.textBaseline = "top";
  context.font = '8px Consolas, "SFMono-Regular", monospace';
  context.fillStyle = "#83928a";
  context.textAlign = "left";
  context.fillText(
    fittedText(context, options.headerLabel, innerWidth * 0.62),
    innerX,
    y + 10,
  );
  context.fillStyle = "#aebbb4";
  context.textAlign = "right";
  context.fillText(
    fittedText(context, options.headerValue, innerWidth * 0.38),
    innerX + innerWidth,
    y + 10,
  );

  context.font = "650 20px Inter, Arial, sans-serif";
  context.fillStyle = "#edf4ef";
  context.textAlign = "left";
  const unit = options.unit?.trim();
  const unitWidth = unit
    ? Math.min(54, context.measureText(unit).width + 8)
    : 0;
  context.fillText(
    fittedText(context, options.formattedValue, innerWidth - unitWidth),
    innerX,
    y + 29,
  );
  if (unit) {
    const valueWidth = Math.min(
      context.measureText(options.formattedValue).width,
      innerWidth - unitWidth,
    );
    context.font = "9px Inter, Arial, sans-serif";
    context.fillStyle = "#9cab9f";
    context.fillText(
      fittedText(context, unit, unitWidth),
      innerX + valueWidth + 5,
      y + 37,
    );
  }

  context.strokeStyle = "rgba(197, 214, 204, 0.14)";
  context.beginPath();
  context.moveTo(innerX, y + 61.5);
  context.lineTo(innerX + innerWidth, y + 61.5);
  context.stroke();

  context.font = "9px Inter, Arial, sans-serif";
  options.rows.forEach((row, index) => {
    const rowY = y + 68 + index * 18;
    context.fillStyle = "#7f8d86";
    context.textAlign = "left";
    context.fillText(row.label, innerX, rowY);
    const labelWidth = context.measureText(row.label).width;
    context.fillStyle = "#c9d4ce";
    context.font = '9px Consolas, "SFMono-Regular", monospace';
    context.textAlign = "right";
    context.fillText(
      fittedText(context, row.value, innerWidth - labelWidth - 10),
      innerX + innerWidth,
      rowY,
    );
    context.font = "9px Inter, Arial, sans-serif";
  });
  context.restore();
}
