import {
  bindOriginalAssetUrlToImages,
  installPageImageReplacement
} from '../shared/pageImageReplacement.js';
import { extractGeminiImageAssetIds } from '../shared/domAdapter.js';
import {
  createGeminiDownloadIntentGate,
  createGeminiDownloadRpcFetchHook,
  installGeminiDownloadHook
} from './downloadHook.js';
import { createUserscriptBlobFetcher } from './crossOriginFetch.js';
import {
  createPageProcessBridgeClient
} from './pageProcessBridge.js';
import {
  installUserscriptProcessBridge
} from './processBridge.js';
import { installInjectedPageProcessorRuntime } from './pageProcessorRuntime.js';
import { createUserscriptProcessingRuntime } from './processingRuntime.js';
import {
  isGeminiOriginalAssetUrl,
  normalizeGoogleusercontentImageUrl
} from './urlUtils.js';

const USERSCRIPT_WORKER_CODE = typeof __US_WORKER_CODE__ === 'string' ? __US_WORKER_CODE__ : '';
const USERSCRIPT_PAGE_PROCESSOR_CODE =
  typeof __US_PAGE_PROCESSOR_CODE__ === 'string' ? __US_PAGE_PROCESSOR_CODE__ : '';

function shouldSkipFrame(targetWindow) {
  if (!targetWindow) {
    return false;
  }
  try {
    return targetWindow.top && targetWindow.top !== targetWindow.self;
  } catch {
    return false;
  }
}

(async function init() {
  try {
    const targetWindow = typeof unsafeWindow === 'object' && unsafeWindow
      ? unsafeWindow
      : window;
    if (shouldSkipFrame(targetWindow)) {
      return;
    }

    console.log('[Gemini Watermark Remover] Initializing...');
    const originalPageFetch = typeof unsafeWindow?.fetch === 'function'
      ? unsafeWindow.fetch.bind(unsafeWindow)
      : null;
    const userscriptRequest = typeof GM_xmlhttpRequest === 'function'
      ? GM_xmlhttpRequest
      : globalThis.GM_xmlhttpRequest;
    const previewBlobFetcher = createUserscriptBlobFetcher({
      gmRequest: userscriptRequest,
      fallbackFetch: originalPageFetch
    });

    const processingRuntime = createUserscriptProcessingRuntime({
      workerCode: USERSCRIPT_WORKER_CODE,
      env: globalThis,
      logger: console
    });
    await processingRuntime.initialize();
    await installInjectedPageProcessorRuntime({
      targetWindow,
      scriptCode: USERSCRIPT_PAGE_PROCESSOR_CODE,
      logger: console
    });
    const pageProcessClient = createPageProcessBridgeClient({
      targetWindow,
      logger: console,
      fallbackProcessWatermarkBlob: processingRuntime.processWatermarkBlob,
      fallbackRemoveWatermarkFromBlob: processingRuntime.removeWatermarkFromBlob
    });

    installUserscriptProcessBridge({
      targetWindow,
      processWatermarkBlob: processingRuntime.processWatermarkBlob,
      removeWatermarkFromBlob: processingRuntime.removeWatermarkFromBlob,
      logger: console
    });

    const pageImageReplacementController = installPageImageReplacement({
      logger: console,
      fetchPreviewBlob: previewBlobFetcher,
      processWatermarkBlobImpl: pageProcessClient.processWatermarkBlob,
      removeWatermarkFromBlobImpl: pageProcessClient.removeWatermarkFromBlob
    });

    const handleOriginalAssetDiscovered = ({ normalizedUrl, discoveredUrl, intentMetadata }) => {
      const sourceUrl = normalizedUrl || discoveredUrl || '';
      const assetIds = intentMetadata?.assetIds;
      if (!assetIds || !sourceUrl) return;
      bindOriginalAssetUrlToImages({
        root: targetWindow.document || document,
        assetIds,
        sourceUrl
      });
    };
    const downloadIntentGate = createGeminiDownloadIntentGate({
      targetWindow,
      resolveMetadata: (target) => ({
        assetIds: extractGeminiImageAssetIds(target)
      })
    });
    const downloadRpcFetch = createGeminiDownloadRpcFetchHook({
      originalFetch: targetWindow.fetch.bind(targetWindow),
      getIntentMetadata: () => downloadIntentGate.getRecentIntentMetadata(),
      onOriginalAssetDiscovered: ({ rpcUrl, discoveredUrl, intentMetadata }) => {
        handleOriginalAssetDiscovered({
          rpcUrl,
          discoveredUrl,
          normalizedUrl: discoveredUrl,
          intentMetadata
        });
      },
      logger: console
    });
    installGeminiDownloadHook(targetWindow, {
      originalFetch: downloadRpcFetch,
      intentGate: downloadIntentGate,
      isTargetUrl: isGeminiOriginalAssetUrl,
      normalizeUrl: normalizeGoogleusercontentImageUrl,
      processBlob: pageProcessClient.removeWatermarkFromBlob,
      onOriginalAssetDiscovered: ({ normalizedUrl, intentMetadata }) => {
        handleOriginalAssetDiscovered({
          normalizedUrl,
          intentMetadata
        });
      },
      logger: console
    });

    window.addEventListener('beforeunload', () => {
      pageImageReplacementController?.dispose?.();
      downloadIntentGate.dispose();
      processingRuntime.dispose('beforeunload');
    });

    console.log('[Gemini Watermark Remover] Ready');
  } catch (error) {
    console.error('[Gemini Watermark Remover] Initialization failed:', error);
  }
})();
