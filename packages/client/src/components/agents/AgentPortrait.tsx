export function PixelPortrait({
  src,
  alt,
  size,
  active,
}: {
  src: string;
  alt: string;
  size: 'sm' | 'lg';
  active?: boolean;
}) {
  const frame = size === 'lg' ? 'h-28 w-28 p-2' : 'h-12 w-12 p-1';
  const image = size === 'lg' ? 'h-24 w-24' : 'h-10 w-10';

  return (
    <div
      className={`${frame} image-render-pixelated relative flex flex-shrink-0 items-center justify-center border ${
        active ? 'border-sky-200/60 bg-sky-200/10 shadow-[0_0_24px_rgba(125,211,252,0.14)]' : 'border-white/[0.10] bg-black/35'
      }`}
      style={{ clipPath: 'polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))' }}
    >
      <img src={src} alt={alt} className={`${image} block object-contain`} draggable={false} />
    </div>
  );
}
