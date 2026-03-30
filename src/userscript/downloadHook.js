import {
  isGeminiOriginalAssetUrl,
  normalizeGoogleusercontentImageUrl
} from './urlUtils.js';

function buildHookRequestArgs(args, normalizedUrl) {
  const nextArgs = [...args];
  const input = nextArgs[0];

  if (typeof input === 'string') {
    nextArgs[0] = normalizedUrl;
    return nextArgs;
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    nextArgs[0] = new Request(normalizedUrl, input);
    return nextArgs;
  }

  nextArgs[0] = normalizedUrl;
  return nextArgs;
}

function hasHeaderValue(headersLike, headerName) {
  if (!headersLike) return false;
  const normalizedHeaderName = String(headerName || '').toLowerCase();

  if (typeof Headers !== 'undefined' && headersLike instanceof Headers) {
    return headersLike.get(normalizedHeaderName) === '1';
  }

  if (Array.isArray(headersLike)) {
    return headersLike.some(([name, value]) => String(name || '').toLowerCase() === normalizedHeaderName && String(value || '') === '1');
  }

  if (typeof headersLike === 'object') {
    for (const [name, value] of Object.entries(headersLike)) {
      if (String(name || '').toLowerCase() === normalizedHeaderName && String(value || '') === '1') {
        return true;
      }
    }
  }

  return false;
}

function shouldBypassHook(args) {
  const input = args[0];
  const init = args[1];

  if (init?.gwrBypass === true) {
    return true;
  }

  if (input && typeof input === 'object' && input.gwrBypass === true) {
    return true;
  }

  if (typeof Request !== 'undefined' && input instanceof Request && input.headers?.get('x-gwr-bypass') === '1') {
    return true;
  }

  return hasHeaderValue(init?.headers, 'x-gwr-bypass');
}

function buildProcessedResponse(response, blob) {
  const headers = new Headers(response.headers);
  if (blob.type) {
    headers.set('content-type', blob.type);
  }

  return new Response(blob, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isImageResponse(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType) {
    return true;
  }
  return /^image\//i.test(contentType);
}

function serializeResponseHeaders(headers) {
  const entries = {};
  if (!headers || typeof headers.forEach !== 'function') {
    return entries;
  }
  headers.forEach((value, key) => {
    entries[key] = value;
  });
  return entries;
}

const DOWNLOAD_ACTION_LABEL_PATTERN = /(download|copy|下载|复制)/i;
const INTENT_EVENT_TYPES = ['click', 'keydown'];
const DEFAULT_INTENT_WINDOW_MS = 5000;
const GEMINI_DOWNLOAD_RPC_HOST = 'gemini.google.com';
const GEMINI_DOWNLOAD_RPC_PATH = '/_/BardChatUi/data/batchexecute';
const GEMINI_DOWNLOAD_RPC_ID = 'c8o8Fe';
const GEMINI_ORIGINAL_ASSET_URL_PATTERN = /https:(?:(?:\\\\\/)|(?:\\\/)|\/){2}[^\s"'\]]*googleusercontent\.com(?:(?:\\\\\/)|(?:\\\/)|\/)[^\s"'\]]+/gi;

function normalizeActionLabel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectButtonLikeLabels(element) {
  if (!element || typeof element !== 'object') {
    return [];
  }

  const button = typeof element.closest === 'function'
    ? element.closest('button,[role="button"]')
    : null;
  if (!button || typeof button !== 'object') {
    return [];
  }

  return [
    button.getAttribute?.('aria-label') || '',
    button.getAttribute?.('title') || '',
    button.innerText || '',
    button.textContent || ''
  ]
    .map(normalizeActionLabel)
    .filter(Boolean);
}

export function isGeminiDownloadActionTarget(target) {
  return collectButtonLikeLabels(target).some((label) => DOWNLOAD_ACTION_LABEL_PATTERN.test(label));
}

export function createGeminiDownloadIntentGate({
  targetWindow = globalThis,
  now = () => Date.now(),
  windowMs = DEFAULT_INTENT_WINDOW_MS,
  resolveMetadata = () => null
} = {}) {
  let armedUntil = 0;
  let recentIntentMetadata = null;

  function arm(metadata = null) {
    armedUntil = Math.max(armedUntil, now() + windowMs);
    recentIntentMetadata = metadata && typeof metadata === 'object'
      ? { ...metadata }
      : null;
  }

  function hasRecentIntent() {
    return now() <= armedUntil;
  }

  function getRecentIntentMetadata() {
    return hasRecentIntent() ? recentIntentMetadata : null;
  }

  function handleEvent(event) {
    if (!event || typeof event !== 'object') {
      return;
    }

    if (event.type === 'keydown') {
      const key = typeof event.key === 'string' ? event.key : '';
      if (key && key !== 'Enter' && key !== ' ') {
        return;
      }
    }

    if (isGeminiDownloadActionTarget(event.target)) {
      const metadata = typeof resolveMetadata === 'function'
        ? resolveMetadata(event.target, event)
        : null;
      arm(metadata);
    }
  }

  for (const eventType of INTENT_EVENT_TYPES) {
    targetWindow?.addEventListener?.(eventType, handleEvent, true);
  }

  return {
    arm,
    hasRecentIntent,
    getRecentIntentMetadata,
    handleEvent,
    dispose() {
      for (const eventType of INTENT_EVENT_TYPES) {
        targetWindow?.removeEventListener?.(eventType, handleEvent, true);
      }
    }
  };
}

export function isGeminiDownloadRpcUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== GEMINI_DOWNLOAD_RPC_HOST) {
      return false;
    }
    if (parsed.pathname !== GEMINI_DOWNLOAD_RPC_PATH) {
      return false;
    }

    const rpcIds = (parsed.searchParams.get('rpcids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return rpcIds.includes(GEMINI_DOWNLOAD_RPC_ID);
  } catch {
    return false;
  }
}

function decodeEscapedRpcUrl(rawUrl) {
  let decodedUrl = String(rawUrl || '').trim();
  if (!decodedUrl) {
    return '';
  }

  decodedUrl = decodedUrl
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u003a/gi, ':');

  let previous = '';
  while (decodedUrl !== previous) {
    previous = decodedUrl;
    decodedUrl = decodedUrl
      .replace(/\\\\\//g, '/')
      .replace(/\\\//g, '/');
  }

  return decodedUrl
    .replace(/[\\"]+$/g, '')
    .trim();
}

export function extractGeminiOriginalAssetUrlsFromResponseText(responseText) {
  if (typeof responseText !== 'string' || responseText.length === 0) {
    return [];
  }

  const discoveredUrls = new Set();
  for (const match of responseText.matchAll(GEMINI_ORIGINAL_ASSET_URL_PATTERN)) {
    const candidateUrl = decodeEscapedRpcUrl(match[0]);
    const normalizedUrl = normalizeGoogleusercontentImageUrl(candidateUrl);
    if (!isGeminiOriginalAssetUrl(normalizedUrl)) {
      continue;
    }
    discoveredUrls.add(normalizedUrl);
  }

  return Array.from(discoveredUrls);
}

export function createGeminiDownloadRpcFetchHook({
  originalFetch,
  getIntentMetadata = () => null,
  onOriginalAssetDiscovered = null,
  logger = console
}) {
  if (typeof originalFetch !== 'function') {
    throw new TypeError('originalFetch must be a function');
  }

  return async function geminiDownloadRpcFetchHook(...args) {
    if (shouldBypassHook(args)) {
      return originalFetch(...args);
    }

    const input = args[0];
    const rpcUrl = typeof input === 'string' ? input : input?.url;
    if (!isGeminiDownloadRpcUrl(rpcUrl)) {
      return originalFetch(...args);
    }

    const response = await originalFetch(...args);
    if (!response?.ok || typeof response.clone !== 'function') {
      return response;
    }

    try {
      const intentMetadata = typeof getIntentMetadata === 'function'
        ? getIntentMetadata({ args, rpcUrl })
        : null;
      if (!intentMetadata || typeof onOriginalAssetDiscovered !== 'function') {
        return response;
      }

      const responseText = await response.clone().text();
      const discoveredUrls = extractGeminiOriginalAssetUrlsFromResponseText(responseText);
      for (const discoveredUrl of discoveredUrls) {
        await onOriginalAssetDiscovered({
          rpcUrl,
          discoveredUrl,
          intentMetadata
        });
      }
    } catch (error) {
      logger?.warn?.('[Gemini Watermark Remover] Download RPC hook processing failed:', error);
    }

    return response;
  };
}

export function createGeminiDownloadFetchHook({
  originalFetch,
  isTargetUrl,
  normalizeUrl,
  processBlob,
  getIntentMetadata = () => null,
  onOriginalAssetDiscovered = null,
  shouldProcessRequest = () => true,
  logger = console,
  cache = new Map()
}) {
  if (typeof originalFetch !== 'function') {
    throw new TypeError('originalFetch must be a function');
  }
  if (typeof isTargetUrl !== 'function') {
    throw new TypeError('isTargetUrl must be a function');
  }
  if (typeof normalizeUrl !== 'function') {
    throw new TypeError('normalizeUrl must be a function');
  }
  if (typeof processBlob !== 'function') {
    throw new TypeError('processBlob must be a function');
  }
  if (typeof shouldProcessRequest !== 'function') {
    throw new TypeError('shouldProcessRequest must be a function');
  }

  return async function geminiDownloadFetchHook(...args) {
    if (shouldBypassHook(args)) {
      return originalFetch(...args);
    }

    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    if (!isTargetUrl(url)) {
      return originalFetch(...args);
    }
    if (!shouldProcessRequest({ args, url })) {
      return originalFetch(...args);
    }

    const normalizedUrl = normalizeUrl(url);
    const hookArgs = buildHookRequestArgs(args, normalizedUrl);
    const response = await originalFetch(...hookArgs);
    if (!response?.ok) {
      return response;
    }
    if (!isImageResponse(response)) {
      return response;
    }

    const fallbackResponse = typeof response.clone === 'function' ? response.clone() : response;

    try {
      let pendingBlob = cache.get(normalizedUrl);
      if (!pendingBlob) {
        const intentMetadata = typeof getIntentMetadata === 'function'
          ? getIntentMetadata({ args, url, normalizedUrl })
          : null;
        pendingBlob = response.blob()
          .then(async (blob) => {
            const processingContext = {
              url,
              normalizedUrl,
              responseStatus: response.status,
              responseStatusText: response.statusText,
              responseHeaders: serializeResponseHeaders(response.headers)
            };
            if (intentMetadata != null) {
              processingContext.intentMetadata = intentMetadata;
            }
            if (typeof onOriginalAssetDiscovered === 'function') {
              await onOriginalAssetDiscovered(processingContext);
            }
            return processBlob(blob, processingContext);
          })
          .finally(() => {
            if (cache.get(normalizedUrl) === pendingBlob) {
              cache.delete(normalizedUrl);
            }
          });
        cache.set(normalizedUrl, pendingBlob);
      }

      const processedBlob = await pendingBlob;
      return buildProcessedResponse(response, processedBlob);
    } catch (error) {
      logger?.warn?.('[Gemini Watermark Remover] Download hook processing failed:', error);
      return fallbackResponse;
    }
  };
}

export function installGeminiDownloadHook(targetWindow, options) {
  if (!targetWindow || typeof targetWindow !== 'object') {
    throw new TypeError('targetWindow must be an object');
  }

  const intentGate = options?.intentGate || createGeminiDownloadIntentGate({
    targetWindow,
    resolveMetadata: options?.resolveIntentMetadata
  });
  const originalFetch = typeof options?.originalFetch === 'function'
    ? options.originalFetch
    : targetWindow.fetch;
  const hook = createGeminiDownloadFetchHook({
    ...options,
    getIntentMetadata: () => intentGate.getRecentIntentMetadata(),
    shouldProcessRequest: options?.shouldProcessRequest || (() => intentGate.hasRecentIntent()),
    originalFetch
  });

  targetWindow.fetch = hook;
  return hook;
}
