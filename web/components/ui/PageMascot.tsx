/**
 * The original flat Elowen mascot as a quiet page accent. The surrounding aura and slow drift add
 * presence without redrawing the character, adding a card, or competing with the page controls.
 */
export function PageMascot({ className = '', size = 'page', animated = false }: { className?: string; size?: 'page' | 'hero'; animated?: boolean }) {
  const hero = size === 'hero';
  return (
    <span
      data-testid="page-mascot"
      aria-hidden
      className={`relative grid shrink-0 place-items-center ${hero ? 'h-72 w-72' : 'h-14 w-14'} ${className}`}
    >
      <span className="status-orb absolute inset-[22%] rounded-full text-accent" />
      {/* eslint-disable-next-line @next/next/no-img-element -- local brand asset, intentionally unchanged */}
      <img src={animated ? '/images/elowen-inferno.gif' : '/icon.png'} alt="" draggable={false} className={`relative select-none object-contain ${animated ? '' : 'animate-ambient'} ${hero ? 'h-72 w-72 drop-shadow-[0_20px_48px_rgb(255_82_54_/_0.28)]' : 'h-12 w-12 drop-shadow-[0_8px_18px_rgb(255_82_54_/_0.18)]'}`} />
    </span>
  );
}
