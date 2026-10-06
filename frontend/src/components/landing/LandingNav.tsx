import { BrandMark } from "../BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { container } from "./ui";

export function LandingNav() {
  return (
    <header>
      <div className={`${container} grid h-28 grid-cols-[44px_1fr_44px] items-center md:h-36`}>
        <a href="/#top" aria-label="Atmyshelf home" className="col-start-2 flex min-h-11 flex-col items-center justify-center gap-1 [&>svg]:md:h-28 [&>svg]:md:w-28">
          <BrandMark size={80} />
          <span className="font-sans text-lg font-normal tracking-[0.08em]">Atmyshelf</span>
        </a>
        <div className="self-start pt-6"><ThemeToggle /></div>
      </div>
    </header>
  );
}
