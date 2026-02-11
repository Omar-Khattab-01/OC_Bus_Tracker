'use strict';

const express = require('express');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 7860);
const TRACK_SCRIPT = path.join(__dirname, 'track_block.js');
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 90000);
const TRACK_CONCURRENCY = Math.max(1, Number(process.env.TRACK_CONCURRENCY || 2));

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

function fetchLiveResult(block) {
  if (pendingByBlock.has(block)) {
    return pendingByBlock.get(block);
  }

  const promise = enqueue(() => runTrackProcess(block)).finally(() => {
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
    const status = err.code === 2 ? 404 : 500;
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
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.error(`OC Bus Tracker web app listening on :${PORT}`);
});
