import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  load: () => Promise<ArrayBuffer>;
  initialPage?: number;
  onPage?: (page: number, total: number) => void;
}

/** Lazy PDF renderer: canvases are created per page and drawn when they approach the viewport. */
export default function PdfView({ load, initialPage = 1, onPage }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState({ page: 1, total: 0 });
  const cb = useRef(onPage);
  cb.current = onPage;

  useEffect(() => {
    let dead = false;
    let observer: IntersectionObserver | undefined;
    (async () => {
      try {
        const data = await load();
        const doc = await pdfjs.getDocument({ data }).promise;
        if (dead) return;
        const el = scroller.current!;
        const first = await doc.getPage(1);
        const width = el.clientWidth - 24;
        const base = first.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const h = Math.round(base.height * scale);
        el.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'pdf-pages';
        el.appendChild(box);
        observer = new IntersectionObserver(
          (es) => {
            for (const e of es) {
              const c = e.target as HTMLCanvasElement;
              if (!e.isIntersecting || c.dataset.done) continue;
              c.dataset.done = '1';
              doc.getPage(Number(c.dataset.n)).then((pg: any) => {
                const vp = pg.getViewport({ scale: scale * dpr });
                c.width = vp.width; c.height = vp.height;
                return pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
              });
            }
          },
          { root: el, rootMargin: '800px 0px' }
        );
        for (let n = 1; n <= doc.numPages; n++) {
          const c = document.createElement('canvas');
          c.dataset.n = String(n);
          c.style.width = `${width}px`; c.style.height = `${h}px`;
          c.className = 'pdf-page';
          box.appendChild(c);
          observer.observe(c);
        }
        const total = doc.numPages;
        const page = Math.min(Math.max(initialPage, 1), total);
        el.scrollTop = (page - 1) * (h + 12);
        setInfo({ page, total });
        setState('ready');
        el.onscroll = () => {
          const p = Math.min(total, Math.max(1, Math.round(el.scrollTop / (h + 12)) + 1));
          setInfo((i) => (i.page === p ? i : { page: p, total }));
          cb.current?.(p, total);
        };
      } catch (e) {
        if (dead) return;
        setMsg(e instanceof Error ? e.message : 'Could not open PDF');
        setState('error');
      }
    })();
    return () => { dead = true; observer?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pdf">
      {state !== 'ready' && <p className="muted pad">{state === 'loading' ? 'Loading PDF…' : msg}</p>}
      <div className="pdf-scroll" ref={scroller} />
      {state === 'ready' && <div className="pdf-page-ind">Page {info.page} of {info.total}</div>}
    </div>
  );
}
