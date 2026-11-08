import { expect, type Locator } from '@playwright/test';

export async function assertTradingCardFaces(faces: Locator) {
  // Inspectors replay the reveal arrival; measure once finite animations end
  // (continuous ones, such as the floating featured banner, are not awaited).
  await faces.evaluateAll((cards) =>
    Promise.all(
      cards.flatMap((card) =>
        card
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    ),
  );
  const geometry = await faces.evaluateAll((cards) =>
    cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return {
        ratio: bounds.width / bounds.height,
        colouredBorder:
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' && parseFloat(style.borderTopWidth) >= 2,
        copyHasGenres: card.querySelector('.card-face-copy > small') !== null,
      };
    }),
  );
  expect(geometry.length).toBeGreaterThan(0);
  for (const card of geometry) {
    expect(card.ratio).toBeCloseTo(5 / 7, 2);
    expect(card.colouredBorder).toBe(true);
    expect(card.copyHasGenres).toBe(false);
  }
}

// Geometry checks catch the previous full-width banner summaries without
// coupling verification to exact theme colours, gap sizes or breakpoints.
export async function assertPortraitGallery(dialog: Locator, count: number) {
  await expect(dialog.locator('.reveal-gallery')).toHaveCount(1);
  await expect(dialog.getByRole('article')).toHaveCount(count);
  const geometry = await dialog.getByRole('article').evaluateAll((cards) => {
    const bounds = cards.map((card) => card.getBoundingClientRect());
    return {
      bounded: bounds.every((rect) => rect.width > 75 && rect.width <= 245),
      portrait: cards.every((card) => {
        const rect = card.querySelector('.reveal-portrait')!.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.width / rect.height < 0.91;
      }),
      noOverlap: bounds.every((a, i) =>
        bounds.every(
          (b, j) =>
            i === j ||
            a.right <= b.left + 0.5 ||
            b.right <= a.left + 0.5 ||
            a.bottom <= b.top + 0.5 ||
            b.bottom <= a.top + 0.5,
        ),
      ),
    };
  });
  expect(geometry).toEqual({ bounded: true, portrait: true, noOverlap: true });
  await assertTradingCardFaces(dialog.locator('.reveal-gallery .card-face'));
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}
