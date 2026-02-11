'use strict';

const express = require('express');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 7860);
const TRACK_SCRIPT = path.join(__dirname, 'track_block.js');

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60000);
const STALE_TTL_MS = Number(process.env.STALE_TTL_MS || 300000);
const MAX_SYNC_WAIT_MS = Number(process.env.MAX_SYNC_WAIT_MS || 4500);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 90000);
const TRACK_CONCURRENCY = Math.max(1, Number(process.env.TRACK_CONCURRENCY || 2));

const cache = new Map();
const pendingByBlock = new Map();

const queue = [];
let activeWorkers = 0;

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeBlock(input) {
  return String(input || '').trim().toUpperCase();
}

function isLikelyBlock(block) {
  return /^[0-9]{1,3}-[0-9]{1,3}$/.test(block);
}

function nowMs() {
  return Date.now();
}

function getCacheState(block) {
  const entry = cache.get(block);
  if (!entry) return { state: 'none', entry: null };

  const now = nowMs();
  if (entry.freshUntil > now) return { state: 'fresh', entry };
  if (entry.staleUntil > now) return { state: 'stale', entry };

  cache.delete(block);
  return { state: 'none', entry: null };
}

function setCache(block, payload) {
  const now = nowMs();
  cache.set(block, {
    payload,
    updatedAt: now,
    freshUntil: now + CACHE_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
  });
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

function parseTrackOutput(stdoutRaw) {
  const trimmed = String(stdoutRaw || '').trim();
  if (!trimmed) {
    throw new Error('No JSON output from tracker script');
  }

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    throw new Error('Invalid JSON output from tracker script');
  }
}

function runTrackProcess(block) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [TRACK_SCRIPT, block],
      {
        cwd: __dirname,
        timeout: RUN_TIMEOUT_MS,
        env: { ...process.env, HEADLESS: '1' },
        maxBuffer: 3 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || 'Tracker failed').trim();
          const err = new Error(message);
          err.code = Number(error.code);
          reject(err);
          return;
        }

        try {
          resolve(parseTrackOutput(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
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

function ensureRefresh(block) {
  if (pendingByBlock.has(block)) {
    return pendingByBlock.get(block);
  }

  const promise = enqueue(() => runTrackProcess(block))
    .then((payload) => {
      setCache(block, payload);
      return payload;
    })
    .finally(() => {
      pendingByBlock.delete(block);
    });

  pendingByBlock.set(block, promise);
  return promise;
}

async function getFastResult(block) {
  const { state, entry } = getCacheState(block);

  if (state === 'fresh') {
    return {
      status: 'ready',
      payload: entry.payload,
      cached: true,
      stale: false,
      ageMs: nowMs() - entry.updatedAt,
    };
  }

  if (state === 'stale') {
    ensureRefresh(block).catch(() => {
      // Keep stale data if background refresh fails.
    });

    return {
      status: 'ready',
      payload: entry.payload,
      cached: true,
      stale: true,
      ageMs: nowMs() - entry.updatedAt,
    };
  }

  const refreshPromise = ensureRefresh(block);
  const timed = await Promise.race([
    refreshPromise.then((payload) => ({ done: true, payload })),
    new Promise((resolve) => setTimeout(() => resolve({ done: false }), MAX_SYNC_WAIT_MS)),
  ]);

  if (timed.done) {
    return {
      status: 'ready',
      payload: timed.payload,
      cached: false,
      stale: false,
      ageMs: 0,
    };
  }

  return {
    status: 'pending',
    retryAfterMs: 1200,
  };
}

function makeOkResponse(result) {
  return {
    ok: true,
    block: result.payload.block,
    buses: result.payload.buses,
    cached: result.cached,
    stale: result.stale,
    ageMs: result.ageMs,
    reply: formatChatReply(result.payload),
    generatedAt: new Date().toISOString(),
  };
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
    const result = await getFastResult(block);

    if (result.status === 'pending') {
      res.status(202).json({
        ok: false,
        pending: true,
        block,
        reply: `Warming block ${block}. I will return as soon as data is ready.`,
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    res.json(makeOkResponse(result));
  } catch (err) {
    const status = err.code === 2 ? 404 : 500;
    res.status(status).json({
      ok: false,
      error: String(err.message || 'Unexpected error').slice(0, 500),
    });
  }
}

app.get('/api/track', handleLookup);
app.post('/api/chat', handleLookup);

app.get('/api/result', (req, res) => {
  const block = normalizeBlock(req.query.block);
  if (!validateBlockOrSend(block, res)) return;

  const { state, entry } = getCacheState(block);
  if (state === 'none') {
    const isPending = pendingByBlock.has(block);
    res.status(isPending ? 202 : 404).json({
      ok: false,
      pending: isPending,
      error: isPending ? 'Still processing.' : 'No result yet for this block.',
    });
    return;
  }

  res.json({
    ok: true,
    block: entry.payload.block,
    buses: entry.payload.buses,
    cached: true,
    stale: state === 'stale',
    ageMs: nowMs() - entry.updatedAt,
    reply: formatChatReply(entry.payload),
    generatedAt: new Date().toISOString(),
  });
});

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    queueDepth: queue.length,
    activeWorkers,
    pendingBlocks: pendingByBlock.size,
    cacheSize: cache.size,
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.error(`OC Bus Tracker web app listening on :${PORT}`);
});
