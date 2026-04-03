import test from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregatePreviewAlphaMaps,
    blurAlphaMap,
    estimatePreviewAlphaMap,
    fitConstrainedPreviewAlphaModel
} from '../../src/core/previewAlphaCalibration.js';
import { removeWatermark } from '../../src/core/blendModes.js';
import { warpAlphaMap } from '../../src/core/adaptiveDetector.js';
import {
    applySyntheticWatermark,
    cloneTestImageData,
    createPatternImageData,
    createSyntheticAlphaMap
} from './syntheticWatermarkTestUtils.js';

function createPosition(size) {
    return {
        x: 16,
        y: 20,
        width: size,
        height: size
    };
}

function computeMeanAbsoluteError(left, right) {
    let total = 0;
    for (let i = 0; i < left.length; i++) {
        total += Math.abs(left[i] - right[i]);
    }
    return total / left.length;
}

function applyBlurIndependent(alphaMap, size, radius) {
    if (radius <= 0) return new Float32Array(alphaMap);

    let current = new Float32Array(alphaMap);
    for (let pass = 0; pass < radius; pass++) {
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
                next[y * size + x] = sum / weight;
            }
        }
        current = next;
    }
    return current;
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

test('estimatePreviewAlphaMap should recover a white watermark alpha map from paired source and preview pixels', () => {
    const size = 10;
    const alphaMap = createSyntheticAlphaMap(size);
    const sourceImageData = createPatternImageData(48, 48);
    const previewImageData = cloneTestImageData(sourceImageData);
    const position = createPosition(size);

    applySyntheticWatermark(previewImageData, alphaMap, position, 1);

    const estimated = estimatePreviewAlphaMap({
        sourceImageData,
        previewImageData,
        position
    });

    const meanAbsoluteError = computeMeanAbsoluteError(estimated, alphaMap);
    assert.ok(meanAbsoluteError < 0.02, `meanAbsoluteError=${meanAbsoluteError}`);
});

test('estimatePreviewAlphaMap should clamp invalid divisions instead of emitting NaN for saturated source pixels', () => {
    const sourceImageData = createPatternImageData(32, 32);
    const previewImageData = cloneTestImageData(sourceImageData);
    const position = createPosition(4);

    for (let row = 0; row < position.height; row++) {
        for (let col = 0; col < position.width; col++) {
            const idx = ((position.y + row) * sourceImageData.width + (position.x + col)) * 4;
            sourceImageData.data[idx] = 255;
            sourceImageData.data[idx + 1] = 255;
            sourceImageData.data[idx + 2] = 255;
            previewImageData.data[idx] = 255;
            previewImageData.data[idx + 1] = 255;
            previewImageData.data[idx + 2] = 255;
        }
    }

    const estimated = estimatePreviewAlphaMap({
        sourceImageData,
        previewImageData,
        position
    });

    assert.equal([...estimated].every((value) => Number.isFinite(value)), true);
    assert.equal([...estimated].every((value) => value === 0), true);
});

test('aggregatePreviewAlphaMaps should use the per-pixel median to reject an outlier sample', () => {
    const baseline = new Float32Array([0.1, 0.3, 0.5, 0.7]);
    const nearBaseline = new Float32Array([0.11, 0.29, 0.51, 0.69]);
    const outlier = new Float32Array([0.9, 0.9, 0.9, 0.9]);

    const aggregated = aggregatePreviewAlphaMaps([
        baseline,
        nearBaseline,
        outlier
    ]);

    assert.deepEqual(
        [...aggregated].map((value) => Number(value.toFixed(2))),
        [0.11, 0.30, 0.51, 0.70]
    );
});

test('blurAlphaMap should preserve bounds while softening the peak alpha', () => {
    const alphaMap = new Float32Array([
        0, 0, 0,
        0, 1, 0,
        0, 0, 0
    ]);

    const blurred = blurAlphaMap(alphaMap, 3, 1);

    assert.equal([...blurred].every((value) => value >= 0 && value <= 1), true);
    assert.ok(blurred[4] < 1, `center=${blurred[4]}`);
    assert.ok(blurred[1] > 0, `edge=${blurred[1]}`);
});

test('fitConstrainedPreviewAlphaModel should beat the unwarped standard alpha on a warped blurred preview sample', () => {
    const size = 16;
    const standardAlpha = createSyntheticAlphaMap(size);
    const previewAlpha = applyBlurIndependent(
        warpAlphaMap(standardAlpha, size, { dx: -0.5, dy: 0.5, scale: 1.02 }),
        size,
        1
    );
    const sourceImageData = createPatternImageData(72, 72);
    const previewImageData = cloneTestImageData(sourceImageData);
    const position = createPosition(size);

    applySyntheticWatermark(previewImageData, previewAlpha, position, 1);

    const naiveRestored = cloneTestImageData(previewImageData);
    removeWatermark(naiveRestored, standardAlpha, position, { alphaGain: 1 });
    const naiveDelta = measureRegionAbsDelta(naiveRestored, sourceImageData, position);

    const fitted = fitConstrainedPreviewAlphaModel({
        sourceImageData,
        previewImageData,
        standardAlphaMap: standardAlpha,
        position,
        shiftCandidates: [-0.5, 0, 0.5],
        scaleCandidates: [1, 1.02],
        blurRadii: [0, 1],
        alphaGainCandidates: [1]
    });

    const fittedRestored = cloneTestImageData(previewImageData);
    removeWatermark(fittedRestored, fitted.alphaMap, position, { alphaGain: fitted.alphaGain });
    const fittedDelta = measureRegionAbsDelta(fittedRestored, sourceImageData, position);

    assert.ok(fittedDelta < naiveDelta * 0.8, `naiveDelta=${naiveDelta}, fittedDelta=${fittedDelta}`);
    assert.deepEqual(fitted.params.shift, { dx: -0.5, dy: 0.5, scale: 1.02 });
    assert.equal(fitted.params.blurRadius, 1);
});
