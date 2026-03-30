import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeminiDownloadFetchHook,
  createGeminiDownloadRpcFetchHook,
  createGeminiDownloadIntentGate,
  extractGeminiOriginalAssetUrlsFromResponseText,
  isGeminiDownloadRpcUrl,
  isGeminiDownloadActionTarget
} from '../../src/userscript/downloadHook.js';
import { isGeminiOriginalAssetUrl } from '../../src/userscript/urlUtils.js';

test('createGeminiDownloadFetchHook should delegate non-target requests untouched', async () => {
  const calls = [];
  const originalFetch = async (...args) => {
    calls.push(args);
    return new Response('plain', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => false,
    normalizeUrl: (url) => `${url}?normalized`,
    processBlob: async () => {
      throw new Error('should not run');
    }
  });

  const response = await hook('https://example.com/file.txt');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://example.com/file.txt');
  assert.equal(await response.text(), 'plain');
});

test('createGeminiDownloadFetchHook should normalize Gemini asset url and replace response body with processed blob', async () => {
  const seenUrls = [];
  const originalFetch = async (input) => {
    seenUrls.push(typeof input === 'string' ? input : input.url);
    return new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png', 'x-source': 'origin' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: (url) => url.includes('googleusercontent.com'),
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async (blob) => {
      assert.equal(await blob.text(), 'original');
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');

  assert.deepEqual(seenUrls, ['https://lh3.googleusercontent.com/rd-gg/token=s0']);
  assert.equal(await response.text(), 'processed');
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');
  assert.equal(response.headers.get('x-source'), 'origin');
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('createGeminiDownloadFetchHook should pass a serializable processing context without the raw Response object', async () => {
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'image/png', 'x-source': 'origin' }
  });

  let seenContext = null;
  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes',
    processBlob: async (_blob, context) => {
      seenContext = context;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  await hook('https://lh3.googleusercontent.com/gg/token=d-I?alr=yes');

  assert.deepEqual(seenContext, {
    url: 'https://lh3.googleusercontent.com/gg/token=d-I?alr=yes',
    normalizedUrl: 'https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes',
    responseStatus: 200,
    responseStatusText: 'OK',
    responseHeaders: {
      'content-type': 'image/png',
      'x-source': 'origin'
    }
  });
});

test('createGeminiDownloadFetchHook should bypass non-image Gemini responses', async () => {
  let processCalls = 0;
  const originalFetch = async () => new Response('https://lh3.google.com/rd-gg/token=s0-d-I?alr=yes', {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain; charset=UTF-8' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes',
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes');

  assert.equal(processCalls, 0);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=UTF-8');
  assert.equal(await response.text(), 'https://lh3.google.com/rd-gg/token=s0-d-I?alr=yes');
});

test('createGeminiDownloadFetchHook should fall back to original response when processing fails', async () => {
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: (url) => url,
    logger: { warn() {} },
    processBlob: async () => {
      throw new Error('boom');
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');

  assert.equal(await response.text(), 'original');
});

test('createGeminiDownloadFetchHook should reprocess repeated normalized url requests after the in-flight cache settles', async () => {
  let processCount = 0;
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async () => {
      processCount += 1;
      return new Blob([`processed-${processCount}`], { type: 'image/png' });
    }
  });

  const first = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  const second = await hook('https://lh3.googleusercontent.com/rd-gg/token=s512');

  assert.equal(await first.text(), 'processed-1');
  assert.equal(await second.text(), 'processed-2');
  assert.equal(processCount, 2);
});

test('createGeminiDownloadFetchHook should only keep in-flight cache entries and release them after success', async () => {
  let processCount = 0;
  let releaseProcessing = null;
  let notifyProcessingStarted = null;
  const processingStarted = new Promise((resolve) => {
    notifyProcessingStarted = resolve;
  });
  const cache = new Map();
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    cache,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async () => {
      processCount += 1;
      notifyProcessingStarted();
      await new Promise((resolve) => {
        releaseProcessing = resolve;
      });
      return new Blob([`processed-${processCount}`], { type: 'image/png' });
    }
  });

  const firstPromise = hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  const secondPromise = hook('https://lh3.googleusercontent.com/rd-gg/token=s512');
  await processingStarted;

  releaseProcessing();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(await first.text(), 'processed-1');
  assert.equal(await second.text(), 'processed-1');
  assert.equal(processCount, 1);
  assert.equal(cache.size, 0);
});

test('createGeminiDownloadFetchHook should bypass interception when gwr bypass flag is present', async () => {
  const calls = [];
  const originalFetch = async (...args) => {
    calls.push(args);
    return new Response('plain', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async () => {
      throw new Error('should not run');
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024', {
    gwrBypass: true
  });

  assert.equal(await response.text(), 'plain');
  assert.equal(calls.length, 1);
});

test('createGeminiDownloadFetchHook should bypass Gemini preview fetches when only original/download assets are targeted', async () => {
  let processCalls = 0;
  const originalFetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return new Response(url, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: isGeminiOriginalAssetUrl,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/example-token=s0-rj?alr=yes',
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/gg/example-token=s1024-rj?alr=yes');

  assert.equal(processCalls, 0);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=UTF-8');
  assert.equal(
    await response.text(),
    'https://lh3.googleusercontent.com/gg/example-token=s1024-rj?alr=yes'
  );
});

test('isGeminiDownloadActionTarget should recognize copy and download buttons but ignore share actions', () => {
  assert.equal(isGeminiDownloadActionTarget({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? '下载完整尺寸的图片' : '';
        },
        textContent: ''
      };
    }
  }), true);

  assert.equal(isGeminiDownloadActionTarget({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? 'Copy image' : '';
        },
        textContent: ''
      };
    }
  }), true);

  assert.equal(isGeminiDownloadActionTarget({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? '分享图片' : '';
        },
        textContent: ''
      };
    }
  }), false);
});

test('createGeminiDownloadIntentGate should arm only for explicit copy or download gestures', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '分享图片' : '';
          },
          textContent: ''
        };
      }
    }
  });
  assert.equal(gate.hasRecentIntent(), false);

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '复制图片' : '';
          },
          textContent: ''
        };
      }
    }
  });
  assert.equal(gate.hasRecentIntent(), true);

  now += 6000;
  assert.equal(gate.hasRecentIntent(), false);

  gate.dispose();
  assert.equal(listeners.size, 0);
});

test('createGeminiDownloadIntentGate should retain asset ids for the latest explicit download intent', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveMetadata: () => ({
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    })
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '下载完整尺寸的图片' : '';
          },
          textContent: ''
        };
      }
    }
  });

  assert.deepEqual(gate.getRecentIntentMetadata(), {
    assetIds: {
      responseId: 'r_d7ef418292ede05c',
      draftId: 'rc_2315ec0b5621fce5',
      conversationId: 'c_cdec91057e5fdcaf'
    }
  });

  now += 6000;
  assert.equal(gate.getRecentIntentMetadata(), null);
});

test('createGeminiDownloadFetchHook should bypass targeted Gemini asset requests until a processing intent is armed', async () => {
  const seenUrls = [];
  let processCalls = 0;
  let allowProcessing = false;
  const originalFetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    seenUrls.push(url);
    return new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: isGeminiOriginalAssetUrl,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    shouldProcessRequest: () => allowProcessing,
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const bypassed = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  assert.equal(await bypassed.text(), 'original');
  assert.equal(processCalls, 0);
  assert.deepEqual(seenUrls, ['https://lh3.googleusercontent.com/rd-gg/token=s1024']);

  allowProcessing = true;
  const processed = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  assert.equal(await processed.text(), 'processed');
  assert.equal(processCalls, 1);
  assert.deepEqual(seenUrls, [
    'https://lh3.googleusercontent.com/rd-gg/token=s1024',
    'https://lh3.googleusercontent.com/rd-gg/token=s0'
  ]);
});

test('isGeminiDownloadRpcUrl should only match Gemini batchexecute download rpc requests', () => {
  assert.equal(
    isGeminiDownloadRpcUrl('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c'),
    true
  );
  assert.equal(
    isGeminiDownloadRpcUrl('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D&rt=c'),
    false
  );
  assert.equal(
    isGeminiDownloadRpcUrl('https://example.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c'),
    false
  );
});

test('extractGeminiOriginalAssetUrlsFromResponseText should recover googleusercontent original asset urls from escaped rpc payloads', () => {
  const responseText = ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj?foo=1\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj?foo=1\\\"]",null,null,null,"generic"]]';

  assert.deepEqual(extractGeminiOriginalAssetUrlsFromResponseText(responseText), [
    'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-rj?foo=1'
  ]);
});

test('createGeminiDownloadRpcFetchHook should notify discovered original asset urls from download rpc responses', async () => {
  const seen = [];
  const originalFetch = async () => new Response(
    ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]',
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    }
  );

  const hook = createGeminiDownloadRpcFetchHook({
    originalFetch,
    getIntentMetadata: () => ({
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }),
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    }
  });

  const response = await hook('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c');

  assert.equal(response.status, 200);
  assert.equal(await response.text(), ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]');
  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-rj',
    intentMetadata: {
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  }]);
});

test('createGeminiDownloadFetchHook should forward recent intent metadata and notify discovered original assets', async () => {
  let notified = null;
  let seenContext = null;
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0',
    getIntentMetadata: () => ({
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }),
    onOriginalAssetDiscovered: async (context) => {
      notified = context;
    },
    processBlob: async (_blob, context) => {
      seenContext = context;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg-dl/token=s1024');

  assert.equal(await response.text(), 'processed');
  assert.deepEqual(seenContext.intentMetadata, {
    assetIds: {
      responseId: 'r_d7ef418292ede05c',
      draftId: 'rc_2315ec0b5621fce5',
      conversationId: 'c_cdec91057e5fdcaf'
    }
  });
  assert.deepEqual(notified.intentMetadata, seenContext.intentMetadata);
  assert.equal(notified.normalizedUrl, 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0');
});
