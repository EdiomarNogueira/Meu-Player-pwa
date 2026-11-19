import React, { useId, useMemo, useState } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';

export interface ImageAdjustmentValues {
  brightness: number;
  contrast: number;
  saturation: number;
  shadows: number;
  highlights: number;
  sharpness: number;
}

const DEFAULT_VALUES: ImageAdjustmentValues = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  shadows: 0,
  highlights: 0,
  sharpness: 0,
};

const ADJUSTMENT_FIELDS: Array<{
  key: keyof ImageAdjustmentValues;
  label: string;
  min: number;
  max: number;
  unit: string;
}> = [
  { key: 'brightness', label: 'Brilho', min: 50, max: 160, unit: '%' },
  { key: 'contrast', label: 'Contraste', min: 50, max: 160, unit: '%' },
  { key: 'saturation', label: 'Saturação', min: 0, max: 180, unit: '%' },
  { key: 'shadows', label: 'Sombras', min: -60, max: 60, unit: '' },
  { key: 'highlights', label: 'Luzes', min: -60, max: 60, unit: '' },
  { key: 'sharpness', label: 'Nitidez', min: 0, max: 100, unit: '%' },
];

export const useImageAdjustments = () => {
  const [values, setValues] = useState<ImageAdjustmentValues>(DEFAULT_VALUES);
  const filterId = useId().replace(/:/g, '');

  const filter = useMemo(() => {
    return `brightness(${values.brightness}%) contrast(${values.contrast}%) saturate(${values.saturation}%) url(#${filterId})`;
  }, [filterId, values]);

  // Keep video on compositor-friendly CSS filters; SVG convolution per frame can stutter.
  const videoFilter = useMemo(() => {
    const brightness = Math.max(20, Math.min(220, values.brightness + values.shadows * 0.2 - values.highlights * 0.1));
    const contrast = Math.max(20, Math.min(220, values.contrast - values.shadows * 0.25 - values.highlights * 0.35));
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${values.saturation}%)`;
  }, [values]);

  const curve = useMemo(() => {
    const shadowAmount = values.shadows / 100;
    const highlightAmount = values.highlights / 100;
    return Array.from({ length: 17 }, (_, index) => {
      const x = index / 16;
      const adjusted = x + shadowAmount * (1 - x) ** 2 - highlightAmount * x ** 2;
      return Math.max(0, Math.min(1, adjusted)).toFixed(3);
    }).join(' ');
  }, [values.shadows, values.highlights]);

  const sharpness = values.sharpness / 100 * 0.7;
  const kernel = `0 ${-sharpness} 0 ${-sharpness} ${1 + sharpness * 4} ${-sharpness} 0 ${-sharpness} 0`;

  return {
    values,
    setValue: (key: keyof ImageAdjustmentValues, value: number) => setValues((current) => ({ ...current, [key]: value })),
    reset: () => setValues(DEFAULT_VALUES),
    filter,
    videoFilter,
    filterId,
    curve,
    kernel,
  };
};

interface ImageAdjustmentControlsProps {
  values: ImageAdjustmentValues;
  onChange: (key: keyof ImageAdjustmentValues, value: number) => void;
  onReset: () => void;
  filterId: string;
  curve: string;
  kernel: string;
  isVideo?: boolean;
}

export const ImageAdjustmentControls: React.FC<ImageAdjustmentControlsProps> = ({
  values,
  onChange,
  onReset,
  filterId,
  curve,
  kernel,
  isVideo = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="image-adjustments">
      <svg className="image-adjustments-defs" aria-hidden="true" focusable="false">
        <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={curve} />
            <feFuncG type="table" tableValues={curve} />
            <feFuncB type="table" tableValues={curve} />
          </feComponentTransfer>
          <feConvolveMatrix order="3" kernelMatrix={kernel} divisor="1" preserveAlpha="true" />
        </filter>
      </svg>
      <button
        type="button"
        className={'btn-glass image-adjustments-toggle ' + (isOpen ? 'active-drawer-btn' : '')}
        aria-expanded={isOpen}
        aria-label="Ajustar imagem"
        title="Ajustar imagem"
        onClick={() => setIsOpen((open) => !open)}
      >
        <SlidersHorizontal size={15} />
        <span>Imagem</span>
      </button>
      {isOpen && (
        <div className="image-adjustments-panel" role="group" aria-label="Ajustes de imagem">
          <div className="image-adjustments-panel-head">
            <strong>Ajustes de imagem</strong>
            <button type="button" className="image-adjustments-reset" onClick={onReset}>
              <RotateCcw size={13} /> Restaurar
            </button>
          </div>
          {ADJUSTMENT_FIELDS.map(({ key, label, min, max, unit }) => (
            <label className="image-adjustment-row" key={key}>
              <span>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step="1"
                value={values[key]}
                onChange={(event) => onChange(key, Number(event.target.value))}
                disabled={isVideo && key === 'sharpness'}
                aria-label={label}
              />
              <output>{values[key]}{unit}</output>
            </label>
          ))}
          {isVideo && <small className="image-adjustments-note">No vídeo, sombras e luzes são aproximadas por ajustes leves. Nitidez fica desativada para preservar a fluidez.</small>}
        </div>
      )}
    </div>
  );
};
