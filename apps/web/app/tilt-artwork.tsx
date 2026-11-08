'use client';
import { useRef, type ReactNode, type PointerEvent } from 'react';

// Pointer movement changes decoration only. Touch and keyboard keep a steady,
// usable view; reduced motion disables the effect in CSS as well.
export function TiltArtwork({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const target = useRef<HTMLDivElement>(null);
  function reset() {
    target.current?.style.setProperty('--tilt-x', '0deg');
    target.current?.style.setProperty('--tilt-y', '0deg');
    target.current?.style.setProperty('--light-x', '50%');
    target.current?.style.setProperty('--light-y', '35%');
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== 'mouse' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    target.current?.style.setProperty('--tilt-x', `${(0.5 - y) * 16}deg`);
    target.current?.style.setProperty('--tilt-y', `${(x - 0.5) * 20}deg`);
    target.current?.style.setProperty('--light-x', `${x * 100}%`);
    target.current?.style.setProperty('--light-y', `${y * 100}%`);
  }
  return (
    <div
      className={`tilt-artwork ${className}`}
      onPointerMove={move}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      <div ref={target} className="tilt-surface">
        {children}
      </div>
    </div>
  );
}
