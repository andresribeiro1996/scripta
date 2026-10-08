import { useRef, type PointerEvent } from "react";
import { shineGradientCss, type ShineKind } from "@scripta/shared";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function CardShine({ kind }: { kind: ShineKind }) {
  const ref = useRef<HTMLSpanElement>(null);
  const follow = (event: PointerEvent<HTMLSpanElement>) => {
    const element = ref.current;
    if (!element || reducedMotion()) return;
    const box = element.getBoundingClientRect();
    element.classList.remove("card-shine-idle");
    element.style.backgroundPosition = `${75 - 50 * ((event.clientX - box.left) / box.width)}% 0`;
  };
  const rest = () => {
    const element = ref.current;
    if (!element) return;
    element.classList.add("card-shine-idle");
    element.style.backgroundPosition = "50% 0";
  };
  return <span ref={ref} aria-hidden="true" onPointerMove={follow} onPointerLeave={rest} className="card-shine-idle absolute inset-0 rounded-[1.6%/1.143%]" style={{ backgroundImage: shineGradientCss(kind), backgroundSize: "300% 100%", backgroundPosition: "50% 0" }} />;
}
