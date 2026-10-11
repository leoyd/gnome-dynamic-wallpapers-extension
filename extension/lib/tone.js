// Color tone adjustments used to derive the time-of-day variants of an image.
// Pure JavaScript working on raw RGB(A) buffers, so it runs on previews and
// full-size exports alike.

import {_} from './i18n.js';

// Marks a string for extraction; translated when the presets are used.
const N_ = text => text;

export const NEUTRAL = Object.freeze({
    brightness: 0,     // -1 (black) .. 1 (white)
    contrast: 1,       // 0.5 .. 1.5
    saturation: 1,     // 0 (grayscale) .. 2
    tint: '#ffffff',   // soft-light tint color
    tintStrength: 0,   // 0 .. 1
});

const PRESETS = [
    {label: N_('Night'), hour: 0, brightness: -0.55, contrast: 0.95, saturation: 0.6, tint: '#2b3a8f', tintStrength: 0.85},
    {label: N_('Dawn'), hour: 6, brightness: -0.2, contrast: 1, saturation: 0.9, tint: '#c06c84', tintStrength: 0.6},
    {label: N_('Morning'), hour: 9, brightness: 0.05, contrast: 1.02, saturation: 1.05, tint: '#ffd59e', tintStrength: 0.35},
    {label: N_('Noon'), hour: 13, brightness: 0, contrast: 1.05, saturation: 1.1, tint: '#ffffff', tintStrength: 0},
    {label: N_('Sunset'), hour: 18, brightness: -0.05, contrast: 1.05, saturation: 1.2, tint: '#ff7b3a', tintStrength: 0.65},
    {label: N_('Dusk'), hour: 20, brightness: -0.35, contrast: 1, saturation: 0.8, tint: '#7a4fa3', tintStrength: 0.6},
];

export function defaultVariants() {
    return PRESETS.map(p => ({...p, label: _(p.label)}));
}

export function hexToRgb(hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => c / 255);
}

export function rgbToHex(r, g, b) {
    return `#${[r, g, b].map(c => Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16).padStart(2, '0')).join('')}`;
}

/** Per-channel lookup tables for tint, contrast and brightness. */
function buildLuts(params) {
    const tint = hexToRgb(params.tint);
    const {brightness, contrast, tintStrength} = params;
    return tint.map(t => {
        const lut = new Uint8Array(256);
        for (let v = 0; v < 256; v++) {
            let x = v / 255;
            // Soft light blend (pegtop): neutral for a 50% gray tint.
            const soft = (1 - 2 * t) * x * x + 2 * t * x;
            x += (soft - x) * tintStrength;
            x = (x - 0.5) * contrast + 0.5;
            x = brightness < 0 ? x * (1 + brightness) : x + (1 - x) * brightness;
            lut[v] = Math.round(Math.min(1, Math.max(0, x)) * 255);
        }
        return lut;
    });
}

/**
 * Applies tone parameters to a pixel buffer.
 *
 * @param {Uint8Array} src - RGB or RGBA pixels
 * @param {object} img - {width, height, rowstride, channels}
 * @param {object} params - see NEUTRAL
 * @param {Uint8Array} [dst] - output buffer, same layout as src
 * @returns {Uint8Array}
 */
export function applyTone(src, img, params, dst = new Uint8Array(src.length)) {
    const {width, height, rowstride, channels} = img;
    const [lr, lg, lb] = buildLuts(params);
    const s = params.saturation;
    const hasAlpha = channels === 4;

    for (let y = 0; y < height; y++) {
        const end = y * rowstride + width * channels;
        for (let i = y * rowstride; i < end; i += channels) {
            let r = src[i], g = src[i + 1], b = src[i + 2];
            if (s !== 1) {
                const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                r = l + (r - l) * s;
                g = l + (g - l) * s;
                b = l + (b - l) * s;
                r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
                g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
                b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
            }
            dst[i] = lr[r];
            dst[i + 1] = lg[g];
            dst[i + 2] = lb[b];
            if (hasAlpha)
                dst[i + 3] = src[i + 3];
        }
    }
    return dst;
}

/** Linear mix of two buffers of the same layout (0 = a, 1 = b). */
export function blend(a, b, t, dst = new Uint8Array(a.length)) {
    if (t <= 0) {
        dst.set(a);
    } else if (t >= 1) {
        dst.set(b);
    } else {
        for (let i = 0; i < a.length; i++)
            dst[i] = a[i] + (b[i] - a[i]) * t;
    }
    return dst;
}
