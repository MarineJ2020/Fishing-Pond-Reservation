import { useEffect, useRef } from 'react';

/**
 * Attach to a section wrapper to add the `reveal-visible` class once the
 * element scrolls into view (fires once, then disconnects). Pair with the
 * `.reveal` CSS utility class — children stagger their entrance via
 * nth-child animation-delay, so this only needs to be attached to the list
 * wrapper, not each individual item.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal-visible');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add('reveal-visible');
            observer.disconnect();
          }
        });
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
