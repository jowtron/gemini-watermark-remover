import { warpAlphaMap } from './adaptiveDetector.js';
import { removeWatermark } from './blendModes.js';

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function resolveChannelAlpha(original, preview) {
    const denominator = 255 - original;
    if (!Number.isFinite(denominator) || denominator <= 0) {
        return 0;
    }

    return clamp01((preview - original) / denominator);
}

export function estimatePreviewAlphaMap({
    sourceImageData,
    previewImageData,
    position
}) {
    if (!sourceImageData || !previewImageData || !position) {
        throw new TypeError('estimatePreviewAlphaMap requires sourceImageData, previewImageData, and position');
    }
    if (sourceImageData.width !== previewImageData.width || sourceImageData.height !== previewImageData.height) {
        throw new RangeError('sourceImageData and previewImageData must have identical dimensions');
    }

    const { x, y, width, height } = position;
    if (![x, y, width, height].every((value) => Number.isInteger(value) && value >= 0)) {
        throw new RangeError('position must contain non-negative integer bounds');
    }

    const alphaMap = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const idx = ((y + row) * sourceImageData.width + (x + col)) * 4;
            const r = resolveChannelAlpha(sourceImageData.data[idx], previewImageData.data[idx]);
            const g = resolveChannelAlpha(sourceImageData.data[idx + 1], previewImageData.data[idx + 1]);
            const b = resolveChannelAlpha(sourceImageData.data[idx + 2], previewImageData.data[idx + 2]);

            alphaMap[row * width + col] = clamp01(Math.max(r, g, b));
        }
    }

    return alphaMap;
}

export function aggregatePreviewAlphaMaps(alphaMaps) {
    if (!Array.isArray(alphaMaps) || alphaMaps.length === 0) {
        throw new TypeError('aggregatePreviewAlphaMaps requires at least one alpha map');
    }

    const expectedLength = alphaMaps[0]?.length;
    if (!Number.isInteger(expectedLength) || expectedLength <= 0) {
        throw new TypeError('alpha maps must be typed arrays with a positive length');
    }

    for (const alphaMap of alphaMaps) {
        if (!alphaMap || alphaMap.length !== expectedLength) {
            throw new RangeError('all alpha maps must have identical lengths');
        }
    }

    const aggregated = new Float32Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
        const values = alphaMaps
            .map((alphaMap) => clamp01(alphaMap[i]))
            .sort((left, right) => left - right);
        const middle = Math.floor(values.length / 2);

        aggregated[i] = values.length % 2 === 1
            ? values[middle]
            : (values[middle - 1] + values[middle]) / 2;
    }

    return aggregated;
}

export function blurAlphaMap(alphaMap, size, radius = 0) {
    const blurPasses = Number.isInteger(radius) ? radius : Math.max(0, Math.round(radius || 0));
    if (blurPasses <= 0 || size <= 0) {
        return new Float32Array(alphaMap);
    }

    let current = new Float32Array(alphaMap);
    for (let pass = 0; pass < blurPasses; pass++) {
        const next = new Float32Array(current.length);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sum = 0;
                let weight = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        const yy = y + dy;
                        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
                        const w = dx === 0 && dy === 0 ? 4 : (dx === 0 || dy === 0 ? 2 : 1);
                        sum += current[yy * size + xx] * w;
                        weight += w;
                    }
                }
                next[y * size + x] = clamp01(sum / Math.max(1, weight));
            }
        }
        current = next;
    }

    return current;
}

function cloneImageData(imageData) {
    return {
        width: imageData.width,
        height: imageData.height,
        data: new Uint8ClampedArray(imageData.data)
    };
}

function measureRegionAbsDelta(candidateImageData, targetImageData, position) {
    let total = 0;
    let count = 0;
    for (let row = 0; row < position.height; row++) {
        for (let col = 0; col < position.width; col++) {
            const idx = ((position.y + row) * candidateImageData.width + (position.x + col)) * 4;
            for (let channel = 0; channel < 3; channel++) {
                total += Math.abs(candidateImageData.data[idx + channel] - targetImageData.data[idx + channel]);
                count++;
            }
        }
    }

    return count > 0 ? total / count : 0;
}

export function fitConstrainedPreviewAlphaModel({
    sourceImageData,
    previewImageData,
    standardAlphaMap,
    position,
    shiftCandidates = [-0.5, 0, 0.5],
    scaleCandidates = [0.99, 1, 1.01],
    blurRadii = [0, 1],
    alphaGainCandidates = [1]
}) {
    if (!sourceImageData || !previewImageData || !standardAlphaMap || !position) {
        throw new TypeError('fitConstrainedPreviewAlphaModel requires sourceImageData, previewImageData, standardAlphaMap, and position');
    }

    const size = position.width;
    if (!size || size !== position.height || standardAlphaMap.length !== size * size) {
        throw new RangeError('fitConstrainedPreviewAlphaModel requires a square ROI and matching standardAlphaMap size');
    }

    let best = null;
    for (const scale of scaleCandidates) {
        for (const dy of shiftCandidates) {
            for (const dx of shiftCandidates) {
                const warped = warpAlphaMap(standardAlphaMap, size, { dx, dy, scale });
                for (const blurRadius of blurRadii) {
                    const alphaMap = blurAlphaMap(warped, size, blurRadius);
                    for (const alphaGain of alphaGainCandidates) {
                        const restored = cloneImageData(previewImageData);
                        removeWatermark(restored, alphaMap, position, { alphaGain });
                        const score = measureRegionAbsDelta(restored, sourceImageData, position);

                        if (!best || score < best.score) {
                            best = {
                                alphaMap,
                                alphaGain,
                                params: {
                                    shift: { dx, dy, scale },
                                    blurRadius
                                },
                                score
                            };
                        }
                    }
                }
            }
        }
    }

    return best;
}
