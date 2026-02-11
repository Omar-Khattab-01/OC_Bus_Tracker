'use strict';

const express = require('express');
const path = require('path');
const { trackBlock, createBrowser, ExpectedFailure } = require('./track_block');

const PORT = Number(process.env.PORT || 7860);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 90000);
const TRACK_CONCURRENCY = Math.max(1, Number(process.env.TRACK_CONCURRENCY || 2));

const pendingByBlock = new Map();
const queue = [];
let activeWorkers = 0;

let sharedBrowser = null;
let sharedContext = null;
let browserInitPromise = null;

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeBlock(input) {
  return String(input || '').trim().toUpperCase();
}

function isLikelyBlock(block) {
  return /^[0-9]{1,3}-[0-9]{1,3}$/.test(block);
}

function formatChatReply(payload) {
  const buses = Array.isArray(payload?.buses) ? payload.buses : [];
  if (!buses.length) {
    return `Block ${payload?.block || ''}: no buses found right now.`.trim();
  }

  const lines = [`Block ${payload.block}`];
  for (const bus of buses) {
    lines.push(`Bus ${bus.busNumber}: ${bus.locationText}`);
  }
  return lines.join('\n');
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const err = new Error(`Live lookup timed out after ${ms}ms`);
      err.code = 504;
      setTimeout(() => reject(err), ms);
    }),
  ]);
}

async function resetBrowserState() {
  if (sharedContext) {
    await sharedContext.close().catch(() => {});
    sharedContext = null;
  }
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
  browserInitPromise = null;
}

async function getSharedContext() {
  if (sharedContext) return sharedContext;
  if (browserInitPromise) return browserInitPromise;

  browserInitPromise = (async () => {
    sharedBrowser = await createBrowser(true);
    sharedBrowser.on('disconnected', () => {
      sharedBrowser = null;
      sharedContext = null;
      browserInitPromise = null;
    });
    sharedContext = await sharedBrowser.newContext();
    sharedContext.setDefaultTimeout(15000);
    return sharedContext;
  })();

  try {
    return await browserInitPromise;
  } catch (err) {
    browserInitPromise = null;
    throw err;
  }
}

async function runTrackLive(block) {
  const context = await getSharedContext();
  try {
    return await withTimeout(trackBlock(block, { context, headless: true }), RUN_TIMEOUT_MS);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/Target page, context or browser has been closed|Browser has been closed|Connection closed/i.test(msg)) {
      await resetBrowserState();
      const freshContext = await getSharedContext();
      return withTimeout(trackBlock(block, { context: freshContext, headless: true }), RUN_TIMEOUT_MS);
    }
    throw err;
  }
}

function drainQueue() {
  while (activeWorkers < TRACK_CONCURRENCY && queue.length > 0) {
    const next = queue.shift();
    activeWorkers += 1;

    next
      .job()
      .then(next.resolve, next.reject)
      .finally(() => {
        activeWorkers -= 1;
        drainQueue();
      });
  }
}

function enqueue(job) {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    drainQueue();
  });
}

function fetchLiveResult(block) {
  if (pendingByBlock.has(block)) {
    return pendingByBlock.get(block);
  }

  const promise = enqueue(() => runTrackLive(block)).finally(() => {
    pendingByBlock.delete(block);
  });

  pendingByBlock.set(block, promise);
  return promise;
}

function parseBlockFromReq(req) {
  if (typeof req.query.block === 'string') {
    return normalizeBlock(req.query.block);
  }

  const text = String(req.body?.message || '').trim();
  const match = text.match(/\b(\d{1,3}-\d{1,3})\b/);
  return normalizeBlock(match ? match[1] : text);
}

function validateBlockOrSend(block, res) {
  if (!block) {
    res.status(400).json({ ok: false, error: 'Send a block number like 44-07.' });
    return false;
  }

  if (!isLikelyBlock(block)) {
    res.status(400).json({ ok: false, error: 'Block format must look like 44-07.' });
    return false;
  }

  return true;
}

async function handleLookup(req, res) {
  const block = parseBlockFromReq(req);
  if (!validateBlockOrSend(block, res)) return;

  try {
    const payload = await fetchLiveResult(block);
    res.json({
      ok: true,
      block: payload.block,
      buses: payload.buses,
      cached: false,
      reply: formatChatReply(payload),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    let status = 500;
    if (err instanceof ExpectedFailure && err.step === 'input') status = 400;
    else if (err instanceof ExpectedFailure) status = 404;
    else if (Number(err.code) === 504) status = 504;

    res.status(status).json({
      ok: false,
      error: String(err.message || 'Unexpected error').slice(0, 500),
    });
  }
}

app.get('/api/track', handleLookup);
app.post('/api/chat', handleLookup);

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    queueDepth: queue.length,
    activeWorkers,
    pendingBlocks: pendingByBlock.size,
    liveOnly: true,
    warmBrowser: Boolean(sharedBrowser),
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.error(`OC Bus Tracker web app listening on :${PORT}`);
});

process.on('SIGTERM', async () => {
  await resetBrowserState();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await resetBrowserState();
  process.exit(0);
});
