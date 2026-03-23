import {
  getGeminiImageQuerySelector,
  getPreferredGeminiImageContainer,
  resolveCandidateImageUrl
} from '../shared/domAdapter.js';
import { processOriginalPageImageSource } from '../shared/pageImageReplacement.js';

const DOWNLOAD_LABEL_PATTERN = /download|下载|baixar/i;
const NATIVE_DOWNLOAD_RETRY_FLAG = 'gwrNativeDownloadRetry';
const PROCESSED_PREVIEW_OBJECT_URL_KEY = 'gwrWatermarkObjectUrl';

function getButtonLabel(button) {
  if (!button || typeof button !== 'object') return '';

  const parts = [
    typeof button.textContent === 'string' ? button.textContent : '',
    typeof button.getAttribute === 'function' ? button.getAttribute('aria-label') || '' : '',
    typeof button.getAttribute === 'function' ? button.getAttribute('title') || '' : ''
  ];

  return parts.join(' ').trim();
}

function isDownloadIntentButton(button) {
  return DOWNLOAD_LABEL_PATTERN.test(getButtonLabel(button));
}

function findCandidateImageFromButton(button) {
  const container = typeof button?.closest === 'function'
    ? button.closest('generated-image,.generated-image-container')
    : null;
  const scope = container || getPreferredGeminiImageContainer(button) || null;
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return null;
  }

  for (const image of scope.querySelectorAll(getGeminiImageQuerySelector())) {
    const sourceUrl = resolveCandidateImageUrl(image);
    if (sourceUrl) {
      return image;
    }
  }

  return null;
}

async function defaultResolveDownloadBlob({
  imageElement,
  sourceUrl,
  fetchPreviewBlob,
  removeWatermarkFromBlobImpl
}) {
  const result = await processOriginalPageImageSource({
    sourceUrl,
    imageElement,
    fetchPreviewBlob,
    removeWatermarkFromBlobImpl,
    preferRenderedCaptureForPreview: false,
    allowRenderedCaptureFallbackOnValidationFailure: false
  });
  return result.processedBlob;
}

function resolveExistingProcessedObjectUrl(imageElement) {
  return typeof imageElement?.dataset?.[PROCESSED_PREVIEW_OBJECT_URL_KEY] === 'string'
    ? imageElement.dataset[PROCESSED_PREVIEW_OBJECT_URL_KEY].trim()
    : '';
}

function triggerObjectUrlDownload({
  objectUrl,
  createAnchorElement
}) {
  if (!objectUrl) {
    return false;
  }

  const anchor = createAnchorElement();
  if (!anchor || typeof anchor.click !== 'function') {
    return false;
  }

  anchor.href = objectUrl;
  anchor.download = `gemini-watermark-remover-${Date.now()}.png`;
  anchor.click();
  return true;
}

export function createGeminiDownloadClickHandler({
  targetDocument = globalThis.document || null,
  logger = console,
  fetchPreviewBlob,
  removeWatermarkFromBlobImpl,
  resolveDownloadBlob = defaultResolveDownloadBlob,
  createObjectUrl = globalThis.URL?.createObjectURL?.bind(globalThis.URL) || null,
  revokeObjectUrl = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL) || null,
  createAnchorElement = () => targetDocument?.createElement?.('a') || null
} = {}) {
  return async function handleGeminiDownloadClick(event) {
    const button = typeof event?.target?.closest === 'function'
      ? event.target.closest('button,[role="button"]')
      : null;
    if (!button || !isDownloadIntentButton(button)) {
      return;
    }
    if (button?.dataset?.[NATIVE_DOWNLOAD_RETRY_FLAG] === 'true') {
      delete button.dataset[NATIVE_DOWNLOAD_RETRY_FLAG];
      return;
    }

    const imageElement = findCandidateImageFromButton(button);
    if (!imageElement) {
      return;
    }

    const sourceUrl = resolveCandidateImageUrl(imageElement);
    if (!sourceUrl) {
      return;
    }

    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();

    try {
      const processedBlob = await resolveDownloadBlob({
        imageElement,
        sourceUrl,
        fetchPreviewBlob,
        removeWatermarkFromBlobImpl
      });
      if (!(processedBlob instanceof Blob) || typeof createObjectUrl !== 'function') {
        throw new Error('Processed download blob unavailable');
      }

      const objectUrl = createObjectUrl(processedBlob);
      const anchor = createAnchorElement();
      if (!anchor || typeof anchor.click !== 'function') {
        throw new Error('Download anchor unavailable');
      }
      anchor.href = objectUrl;
      anchor.download = `gemini-watermark-remover-${Date.now()}.png`;
      anchor.click();
      revokeObjectUrl?.(objectUrl);
    } catch (error) {
      logger?.warn?.('[Gemini Watermark Remover] Active download interception failed:', error);
      const existingProcessedObjectUrl = resolveExistingProcessedObjectUrl(imageElement);
      if (triggerObjectUrlDownload({
        objectUrl: existingProcessedObjectUrl,
        createAnchorElement
      })) {
        return;
      }
      if (button?.dataset && typeof button.click === 'function') {
        button.dataset[NATIVE_DOWNLOAD_RETRY_FLAG] = 'true';
        try {
          button.click();
        } finally {
          delete button.dataset[NATIVE_DOWNLOAD_RETRY_FLAG];
        }
      }
    }
  };
}

export function installGeminiDownloadClickHandler(options = {}) {
  const {
    targetDocument = globalThis.document || null
  } = options;

  if (!targetDocument || typeof targetDocument.addEventListener !== 'function') {
    return null;
  }

  const handler = createGeminiDownloadClickHandler({
    ...options,
    targetDocument
  });

  targetDocument.addEventListener('click', handler, true);
  return {
    handler,
    dispose() {
      targetDocument.removeEventListener?.('click', handler, true);
    }
  };
}
