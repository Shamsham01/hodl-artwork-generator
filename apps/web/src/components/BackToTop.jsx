import { useEffect, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react";

const SCROLL_THRESHOLD = 400;

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > SCROLL_THRESHOLD);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 rounded-full glass-panel px-4 py-2.5 text-xs font-medium text-zinc-300 hover:text-white shadow-lg transition-colors"
      aria-label="Back to top"
    >
      <ArrowUp size={16} weight="bold" />
      Top
    </button>
  );
}
