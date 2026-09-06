import { useEffect, useRef, useState } from "react";

export function useMuralFullscreen() {
  const ref = useRef<HTMLDivElement>(null);
  const nativeFullscreen = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    function handleFullscreenChange() {
      if (nativeFullscreen.current && document.fullscreenElement !== ref.current) {
        nativeFullscreen.current = false;
        setFullscreen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && fullscreen && !document.fullscreenElement) setFullscreen(false);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreen]);

  async function enterFullscreen() {
    setFullscreen(true);
    try {
      await ref.current?.requestFullscreen?.();
      nativeFullscreen.current = document.fullscreenElement === ref.current;
    } catch {
      nativeFullscreen.current = false;
    }
  }

  async function exitFullscreen() {
    if (document.fullscreenElement === ref.current) {
      try {
        await document.exitFullscreen();
      } catch {
        nativeFullscreen.current = false;
      }
    }
    setFullscreen(false);
  }

  return { ref, fullscreen, enterFullscreen, exitFullscreen };
}
