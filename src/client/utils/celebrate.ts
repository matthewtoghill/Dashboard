import confetti from 'canvas-confetti';
import type { CompletionAnimation } from '../../shared/types.ts';

const base = { disableForReducedMotion: true, zIndex: 9999 };

// Where the user last clicked (or, after a keypress, the focused element), as 0-1 viewport fractions
const CENTER = { x: 0.5, y: 0.65 };
let last = CENTER;
let at = CENTER; // origin for the animation being played
let centred = true;
const norm = (x: number, y: number) => ({ x: x / window.innerWidth, y: y / window.innerHeight });
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (last = norm(e.clientX, e.clientY)), true);
  window.addEventListener(
    'keydown',
    () => {
      const r = document.activeElement?.getBoundingClientRect();
      if (r && r.width > 0) last = norm(r.left + r.width / 2, r.top + r.height / 2);
    },
    true
  );
}

const ANIMATIONS: Record<Exclude<CompletionAnimation, 'none'>, () => void> = {
  confetti: () => confetti({ ...base, particleCount: 120, spread: 80, origin: at }),
  fireworks: () => {
    // snapshot: the timeouts below outlive this call; centred bursts sit in the upper-middle
    const { x, y } = centred ? { x: at.x, y: 0.35 } : at;
    const jitter = (v: number) => Math.min(0.95, Math.max(0.05, v + (Math.random() - 0.5) * 0.3));
    for (let i = 0; i < 4; i++) {
      setTimeout(
        () =>
          confetti({
            ...base,
            particleCount: 40,
            spread: 360,
            startVelocity: 25,
            ticks: 60,
            origin: { x: jitter(x), y: jitter(y) },
          }),
        i * 250
      );
    }
  },
  stars: () =>
    confetti({
      ...base,
      particleCount: 40,
      spread: 100,
      shapes: ['star'],
      colors: ['#FFE400', '#FFBD00', '#E89400', '#FFCA6C', '#FDFFB8'],
      origin: at,
    }),
  snow: () => {
    const end = Date.now() + 1500;
    const frame = () => {
      confetti({
        ...base,
        particleCount: 2,
        startVelocity: 0,
        ticks: 200,
        gravity: 0.4,
        origin: { x: Math.random(), y: 0 },
        colors: ['#ffffff', '#bae6fd'],
        shapes: ['circle'],
        scalar: 1.2,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  },
  emoji: () =>
    confetti({
      ...base,
      particleCount: 30,
      spread: 90,
      scalar: 2,
      shapes: ['🎉', '✅', '🚀'].map((text) => confetti.shapeFromText({ text, scalar: 2 })),
      origin: at,
    }),
  cannons: () => {
    confetti({ ...base, particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } });
    confetti({ ...base, particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } });
  },
};

export function playCompletionAnimation(name: CompletionAnimation, followPointer = true) {
  if (name === 'none') return;
  centred = !followPointer;
  at = followPointer ? last : CENTER;
  ANIMATIONS[name]();
}
