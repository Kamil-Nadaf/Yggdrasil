import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { getDB } from '../local';

/** View-only player for decks made with the desktop Slides editor (PPTist JSON). Text, images and simple
 *  shapes are drawn; anything else is skipped. No editing on the phone. */
interface El { type: string; left: number; top: number; width: number; height?: number; rotate?: number; content?: string; src?: string; fill?: string; defaultColor?: string; defaultFontName?: string; lineHeight?: number; wordSpace?: number; paragraphSpace?: number; text?: { content?: string } }
interface Slide { id: string; elements: El[]; background?: { type?: string; color?: string; image?: { src?: string } } }
interface Deck { title?: string; slides: Slide[]; viewportSize?: number; viewportRatio?: number; theme?: { backgroundColor?: string; fontColor?: string } }

export function deckList(slug: string): { name: string; modified: string }[] {
  const prefix = `${slug}/`;
  return Object.entries(getDB().decks ?? {})
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, f]) => ({ name: k.slice(prefix.length), modified: f.modified }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

function SlideView({ s, deck, w }: { s: Slide; deck: Deck; w: number }) {
  const vw = deck.viewportSize || 1000, vh = vw * (deck.viewportRatio || 0.5625);
  const k = w / vw;
  const bg = s.background?.type === 'image' && s.background.image?.src ? `center/cover url(${s.background.image.src})` : s.background?.color || deck.theme?.backgroundColor || '#fff';
  return (
    <div style={{ width: w, height: vh * k, position: 'relative', overflow: 'hidden', background: bg, color: deck.theme?.fontColor || '#333' }}>
      {s.elements.map((e, i) => {
        const base = { position: 'absolute' as const, left: e.left * k, top: e.top * k, width: e.width * k, height: e.height ? e.height * k : undefined, transform: e.rotate ? `rotate(${e.rotate}deg)` : undefined };
        if (e.type === 'image' && e.src) return <img key={i} src={e.src} alt="" style={{ ...base, objectFit: 'contain' }} />;
        if (e.type === 'text' && e.content) {
          return <div key={i} style={{ ...base, fontSize: `${16 * k}px`, lineHeight: e.lineHeight || 1.5, color: e.defaultColor, fontFamily: e.defaultFontName, wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.content) }} />;
        }
        if (e.type === 'shape') {
          return <div key={i} style={{ ...base, background: e.fill && !e.fill.startsWith('url') ? e.fill : 'transparent' }}>{e.text?.content && <div style={{ fontSize: `${16 * k}px` }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.text.content) }} />}</div>;
        }
        return null;
      })}
    </div>
  );
}

export default function DeckPlayer({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [w, setW] = useState(() => window.innerWidth);
  const box = useRef<HTMLDivElement>(null);
  let deck: Deck | null = null;
  try { deck = JSON.parse(getDB().decks[`${slug}/${name}`]?.source ?? ''); } catch { deck = null; }
  const n = deck?.slides?.length ?? 0;

  useEffect(() => {
    const fit = () => {
      const b = box.current; if (!b || !deck) return;
      const ratio = deck.viewportRatio || 0.5625;
      setW(Math.floor(Math.min(b.clientWidth, b.clientHeight / ratio)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [deck]);

  if (!deck || n === 0) return <div className="pad"><p className="err">This deck could not be read.</p><button className="btn" onClick={onClose}>Close</button></div>;
  const go = (d: number) => setI((c) => Math.max(0, Math.min(n - 1, c + d)));
  let x0 = 0;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#000', display: 'flex', flexDirection: 'column' }}
      onTouchStart={(e) => { x0 = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); }}>
      <div ref={box} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => go(1)}>
        <SlideView s={deck.slides[i]} deck={deck} w={w} />
      </div>
      <div className="row between pad" style={{ color: '#ccc' }}>
        <button className="btn" onClick={onClose}>Close</button>
        <span>{i + 1} / {n}</span>
        <span><button className="btn" onClick={() => go(-1)} disabled={i === 0}>‹</button> <button className="btn" onClick={() => go(1)} disabled={i >= n - 1}>›</button></span>
      </div>
    </div>
  );
}
