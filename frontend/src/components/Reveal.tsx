import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  delay?: number;
  dir?: "up" | "left" | "right" | "scale";
  className?: string;
}

export function Reveal({ children, delay = 0, dir = "up", className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      if (delay > 0) {
        setTimeout(() => el.classList.add("is-in"), delay);
      } else {
        el.classList.add("is-in");
      }
    };

    // If the element is in or near the viewport, show immediately
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 1.1) {
      show();
      return;
    }

    // For elements below the fold, use IntersectionObserver
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          observer.disconnect();
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(el);

    // Safety fallback: always reveal after a short timeout so content is never stuck invisible
    const fallback = setTimeout(show, 800);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [delay]);

  return (
    <div ref={ref} className={`reveal reveal-${dir} ${className}`}>
      {children}
    </div>
  );
}
