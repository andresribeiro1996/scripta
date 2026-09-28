import { useEffect, useId, useState, type CSSProperties } from "react";
import { ENTRANCE, MARK_BOOKPLATE, MARK_EXTRA_COLORS, MARK_RECTS, MARK_VIEWBOX, layerEntrance, markTreatment, resolveTheme, type MarkEntrance, type MarkFill } from "@scripta/shared/themes";
import { osScheme, useThemePreference } from "../lib/theme";

let entrancePlayed = false;

function color(fill: MarkFill): string {
  if (fill === "text") return "var(--color-text)";
  if (fill === "accent") return "var(--color-accent)";
  return MARK_EXTRA_COLORS[fill];
}

function entranceVars(entrance: MarkEntrance): CSSProperties {
  return {
    "--mark-ms": `${ENTRANCE[entrance].ms}ms`,
    "--mark-steps": ENTRANCE.scan.steps,
    "--mark-rise": `${(ENTRANCE.rise.from / 84) * 100}%`,
    "--mark-gild-ms": `${ENTRANCE.gild.markMs}ms`,
    "--mark-gild-delay": `${ENTRANCE.gild.markDelayMs}ms`,
  } as CSSProperties;
}

function MarkRects() {
  return (
    <>
      {MARK_RECTS.map((rect) => (
        <rect key={`${rect.x},${rect.y}`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} transform={rect.rotate ? `rotate(${rect.rotate.join(" ")})` : undefined} />
      ))}
    </>
  );
}

export function BrandMark({ size }: { size: number }) {
  const id = resolveTheme(useThemePreference(), osScheme());
  const treatment = markTreatment(id);
  const [initialId] = useState(() => (entrancePlayed ? null : id));
  const [themeChanged, setThemeChanged] = useState(false);
  if (initialId !== null && !themeChanged && id !== initialId) setThemeChanged(true);
  useEffect(() => {
    entrancePlayed = true;
  }, []);
  const maskId = useId();
  const entrance = id === initialId && !themeChanged ? treatment.entrance : null;
  const { outer, inner } = MARK_BOOKPLATE;
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true" className={entrance ? `mark-${entrance}` : undefined} style={entrance ? entranceVars(entrance) : undefined}>
      {treatment.stripes ? (
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-4} y={-4} width={84} height={84}>
          <rect x={-4} y={-4} width={84} height={84} fill="#fff" />
          {treatment.stripes.map(([y, height]) => (
            <rect key={y} x={-4} y={y} width={84} height={height} fill="#000" />
          ))}
        </mask>
      ) : null}
      {treatment.bookplate
        ? [outer, inner].map((line) => (
            <rect
              key={line.size}
              className="mark-gild-frame"
              x={line.x}
              y={line.y}
              width={line.size}
              height={line.size}
              rx={line.radius}
              style={{ fill: "none", stroke: color("accent"), strokeWidth: line.stroke, strokeDasharray: line.perimeter, "--mark-dash": line.perimeter } as CSSProperties}
            />
          ))
        : null}
      <g className={treatment.bookplate ? "mark-gild-mark" : undefined} transform={treatment.bookplate ? MARK_BOOKPLATE.markTransform : undefined} mask={treatment.stripes ? `url(#${maskId})` : undefined}>
        {treatment.layers.map((layer, index) => {
          const enter = entrance ? layerEntrance(treatment, index) : null;
          return (
            <g key={index} transform={`translate(${layer.offset[0]} ${layer.offset[1]})`} opacity={layer.opacity} style={{ fill: color(layer.fill) }}>
              <g
                className={enter ? "mark-layer" : undefined}
                style={enter ? ({ "--mark-from-x": `${enter.from[0]}px`, "--mark-from-y": `${enter.from[1]}px`, "--mark-from-opacity": enter.fade ? 0 : 1, animationDelay: `${enter.delayMs}ms` } as CSSProperties) : undefined}
              >
                <MarkRects />
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
