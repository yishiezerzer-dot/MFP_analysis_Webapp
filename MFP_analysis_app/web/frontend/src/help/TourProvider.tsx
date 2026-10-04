import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Compass, X } from "lucide-react";
import { ICON_PROPS } from "../components/common/ChartCardParts";
import { tabOfRoute } from "./controls";
import { revealControl } from "./reveal";
import { getTour, tourForTab, type Tour } from "./tours";

interface TourContextValue {
  startTour: (id: string) => void;
}

const TourContext = createContext<TourContextValue>({ startTour: () => {} });

export function useTour() {
  return useContext(TourContext);
}

const offeredKey = (tourId: string) => `mfp.tour.offered.${tourId}`;

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

function setFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // storage unavailable: the offer may show again
  }
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;

// Dims the page except the step's control and shows the step card next to it.
function TourOverlay({ tour, onClose }: { tour: Tour; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const step = tour.steps[index];
  const last = index === tour.steps.length - 1;

  useEffect(() => {
    let cancelled = false;
    setRect(null);
    setMissing(false);
    revealControl(step.control, 1500, { highlight: false }).then((result) => {
      if (!cancelled && result === "not-found") setMissing(true);
    });
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-control="${step.control}"]`);
      const r = el?.getBoundingClientRect();
      const found = r && r.width > 0;
      setRect(found ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
      if (found) setMissing(false);
    };
    measure();
    const timer = window.setInterval(measure, 150);
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [step.control]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(tour.steps.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, tour.steps.length]);

  const card = useMemo(() => {
    const width = 320;
    if (!rect) return { top: window.innerHeight / 2 - 90, left: window.innerWidth / 2 - width / 2, width };
    const below = rect.top + rect.height + PAD + 12;
    const top = below + 190 < window.innerHeight ? below : Math.max(12, rect.top - PAD - 12 - 190);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    return { top, left, width };
  }, [rect]);

  return (
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-brand-500 transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/45" />
      )}
      <div
        role="dialog"
        aria-label={tour.title}
        className="card-raised fixed flex flex-col gap-2 p-4 text-[13px] text-ink-800"
        style={{ top: card.top, left: card.left, width: card.width }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-caption">
              {tour.title} · {index + 1} of {tour.steps.length}
            </div>
            <div className="text-card-title mt-0.5">{step.title}</div>
          </div>
          <button type="button" className="btn-ghost px-1.5" aria-label="Close tour" onClick={onClose}>
            <X {...ICON_PROPS} />
          </button>
        </div>
        <p className="text-ink-700">{step.text}</p>
        {missing && (
          <p className="text-[12px] text-ink-500">
            This part appears once a file is open — use Try with example data to see it.
          </p>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            Skip tour
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost border border-ink-200" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// "Take the 1-minute tour?" shown once per tab, the first time it is opened.
function TourOffer({ tour, onAnswer }: { tour: Tour; onAnswer: (take: boolean) => void }) {
  return (
    <div
      role="dialog"
      aria-label={`Offer: ${tour.title}`}
      className="card-raised fixed bottom-6 right-6 z-[70] flex w-80 flex-col gap-2 p-4 text-[13px]"
    >
      <div className="flex items-center gap-2 font-semibold text-ink-900">
        <Compass {...ICON_PROPS} className="text-brand-600" />
        New here? Take the 1-minute tour
      </div>
      <p className="text-ink-600">A few steps that show where the main controls are. You can replay it from Help.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => onAnswer(false)}>
          No thanks
        </button>
        <button type="button" className="btn-primary" onClick={() => onAnswer(true)}>
          Take the tour
        </button>
      </div>
    </div>
  );
}

export function TourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [active, setActive] = useState<Tour | null>(null);
  const [offer, setOffer] = useState<Tour | null>(null);

  const startTour = useCallback((id: string) => {
    const tour = getTour(id);
    if (!tour) return;
    setFlag(offeredKey(tour.id));
    setOffer(null);
    setActive(tour);
  }, []);

  useEffect(() => {
    const tour = tourForTab(tabOfRoute(location.pathname));
    setOffer(tour && !readFlag(offeredKey(tour.id)) ? tour : null);
  }, [location.pathname]);

  const value = useMemo(() => ({ startTour }), [startTour]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {offer && !active && (
        <TourOffer
          tour={offer}
          onAnswer={(take) => {
            setFlag(offeredKey(offer.id));
            setOffer(null);
            if (take) setActive(offer);
          }}
        />
      )}
      {active && <TourOverlay tour={active} onClose={() => setActive(null)} />}
    </TourContext.Provider>
  );
}
