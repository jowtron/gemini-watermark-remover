import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCallSource,
  getConstArrayItems,
  hasImportedBinding,
  loadModuleSource,
  normalizeWhitespace
} from '../testUtils/moduleStructure.js';

test('userscript entry should install download hook and page image replacement without default active click interception', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.equal(hasImportedBinding(source, './downloadHook.js', 'installGeminiDownloadHook'), true);
  assert.equal(hasImportedBinding(source, './downloadHook.js', 'createGeminiDownloadRpcFetchHook'), true);
  assert.equal(hasImportedBinding(source, '../shared/pageImageReplacement.js', 'installPageImageReplacement'), true);
  assert.equal(hasImportedBinding(source, './processBridge.js', 'installUserscriptProcessBridge'), true);
   assert.equal(hasImportedBinding(source, './pageProcessBridge.js', 'createPageProcessBridgeClient'), true);
   assert.equal(hasImportedBinding(source, './pageProcessorRuntime.js', 'installInjectedPageProcessorRuntime'), true);
  assert.equal(hasImportedBinding(source, './downloadClick.js', 'installGeminiDownloadClickHandler'), false);
});

test('userscript entry should skip initialization inside nested frames', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.match(normalizeWhitespace(source), /function shouldSkipFrame\(targetWindow\)/);
  assert.match(normalizeWhitespace(source), /if \(shouldSkipFrame\(targetWindow\)\) \{ return; \}/);
});

test('userscript entry should explicitly pass GM_xmlhttpRequest to preview fetching', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const createBlobFetcherCall = normalizeWhitespace(getCallSource(source, 'createUserscriptBlobFetcher'));

  assert.match(createBlobFetcherCall, /gmRequest:\s*userscriptRequest/);
  assert.match(normalizeWhitespace(source), /typeof GM_xmlhttpRequest === 'function'/);
});

test('userscript entry should not eagerly warm the main-thread engine during init', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.doesNotMatch(normalizeWhitespace(source), /getEngine\(\)\.catch/);
});

test('userscript entry should verify inline worker readiness before enabling acceleration', () => {
  const source = loadModuleSource('../../src/userscript/processingRuntime.js', import.meta.url);

  assert.match(normalizeWhitespace(source), /await workerClient\.ping\(\)/);
  assert.match(normalizeWhitespace(source), /Worker initialization failed,\s*using main thread/);
});

test('userscript entry should route page image processing through page runtime bridge with processingRuntime fallback', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const installDownloadHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiDownloadHook'));
  const installDownloadRpcHookCall = normalizeWhitespace(getCallSource(source, 'createGeminiDownloadRpcFetchHook'));
  const installPageReplacementCall = normalizeWhitespace(getCallSource(source, 'installPageImageReplacement'));

  assert.equal(hasImportedBinding(source, './urlUtils.js', 'isGeminiOriginalAssetUrl'), true);
  assert.match(normalizeWhitespace(source), /await installInjectedPageProcessorRuntime\(/);
  assert.match(installDownloadHookCall, /isTargetUrl:\s*isGeminiOriginalAssetUrl/);
  assert.match(installDownloadRpcHookCall, /getIntentMetadata:\s*\(\)\s*=>\s*downloadIntentGate\.getRecentIntentMetadata\(\)/);
  assert.match(installDownloadHookCall, /processBlob:\s*pageProcessClient\.removeWatermarkFromBlob/);
  assert.match(installPageReplacementCall, /processWatermarkBlobImpl:\s*pageProcessClient\.processWatermarkBlob/);
  assert.match(installPageReplacementCall, /removeWatermarkFromBlobImpl:\s*pageProcessClient\.removeWatermarkFromBlob/);
  assert.doesNotMatch(installPageReplacementCall, /bridgeClient\./);
});

test('userscript entry should delegate watermark runtime logic to processingRuntime module', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const bridgeInstallCall = normalizeWhitespace(getCallSource(source, 'installUserscriptProcessBridge'));

  assert.equal(hasImportedBinding(source, './processingRuntime.js', 'createUserscriptProcessingRuntime'), true);
  assert.match(normalizeWhitespace(source), /const processingRuntime = createUserscriptProcessingRuntime\(/);
  assert.match(normalizeWhitespace(source), /await processingRuntime\.initialize\(\)/);
  assert.match(bridgeInstallCall, /processWatermarkBlob:\s*processingRuntime\.processWatermarkBlob/);
  assert.match(bridgeInstallCall, /removeWatermarkFromBlob:\s*processingRuntime\.removeWatermarkFromBlob/);
});

test('userscript entry should not inline duplicate worker runtime implementation', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.doesNotMatch(normalizeWhitespace(source), /class InlineWorkerClient/);
  assert.doesNotMatch(normalizeWhitespace(source), /function getEngine\(/);
  assert.doesNotMatch(normalizeWhitespace(source), /function processBlobWithBestPath\(/);
});

test('page image replacement should not observe self-written stable source attributes', () => {
  const source = loadModuleSource('../../src/shared/pageImageReplacement.js', import.meta.url);
  const observedAttributes = getConstArrayItems(source, 'OBSERVED_ATTRIBUTES');
  assert.equal(observedAttributes.includes('data-gwr-stable-source'), false);
});
