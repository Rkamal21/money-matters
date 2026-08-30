import { useState, useEffect } from 'react';
import './SplashScreen.css';

const SHOW_MS = 1600;
const FADE_OUT_MS = 400;

export function SplashScreen({ onComplete }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setExiting(true), SHOW_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => onComplete?.(), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [exiting, onComplete]);

  return (
    <div className={`splash ${exiting ? 'splash-exit' : ''}`} aria-hidden="true">
      <div className="splash-glow" />
      <div className="splash-content">
        <div className="splash-rupee-wrap">
          <span className="splash-rupee">₹</span>
        </div>
        <h1 className="splash-title">Money Matters</h1>
        <div className="splash-line" />
      </div>
    </div>
  );
}
