---
title: OC Bus Tracker
emoji: 🚌
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Chat-style OC Transpo block to bus location tracker
---

# OC Bus Tracker Chat

Portfolio-ready web chatbot for tracking live OC Transpo bus locations from a block number (for example `44-07`).

## Brief Description

OC Bus Tracker Chat is a full-stack Node.js + Playwright app that:
- Reads bus IDs from BetterTransit block data
- Looks up each bus on TransSee
- Returns street-level location text in a chat interface
- Uses queue + stale-while-revalidate caching for fast responses under load

## Live Links

- Hugging Face Space: [OC Bus Tracker](https://huggingface.co/spaces/OmarLKhattab/OC_Bus_Tracker)
- GitHub Repository: [OmarLKhattab/OC_Bus_Tracker](https://github.com/OmarLKhattab/OC_Bus_Tracker)

## Screenshots

### Chat Home

![OC Bus Tracker Chat Home](https://image.thum.io/get/width/1600/https://huggingface.co/spaces/OmarLKhattab/OC_Bus_Tracker)

### Chat Interaction (Real Flow: Input -> Steps -> Result)

![OC Bus Tracker Chat Interaction](https://image.thum.io/get/width/1600/https://huggingface.co/spaces/OmarLKhattab/OC_Bus_Tracker?demo=1&block=44-07)

## Real Example (Input -> Output)

### Chat Example

```text
User: 44-07
Bot:
Block 44-07
Bus 6698: past Longfields on Chapman Mills
```

### API Example

Request:

```bash
curl -s -X POST https://omarLkhattab-oc-bus-tracker.hf.space/api/chat \
  -H "content-type: application/json" \
  --data '{"message":"44-07"}'
```

Response shape:

```json
{
  "ok": true,
  "block": "44-07",
  "buses": [
    {
      "busNumber": "6698",
      "locationText": "past Longfields on Chapman Mills",
      "url": "https://transsee.ca/fleetfind?a=octranspo&findtrack=1&q=6698&Go=Go"
    }
  ],
  "cached": true,
  "reply": "Block 44-07\nBus 6698: past Longfields on Chapman Mills"
}
```

## Features

- Chat-based UX with OC Transpo-themed design
- Block format parsing (e.g. `5-07`, `44-07`)
- Fast API behavior with queue + request coalescing + cache
- Automatic pending-state polling on first uncached request
- Structured API output (`block`, `buses`, `locationText`, `url`)
- Dockerized for Hugging Face Spaces deployment

## Tech Stack

- Node.js + Express
- Playwright (Chromium)
- HTML/CSS/Vanilla JS frontend
- Docker (HF Spaces SDK: Docker)

## Run Locally

```bash
npm install
npm start
```

Open: `http://localhost:7860`

## Usage

1. Enter a block number such as `44-07`
2. The app warms cache if needed
3. You get one or more bus cards with current location text

## API Endpoints

### `POST /api/chat`

Request body:

```json
{ "message": "44-07" }
```

### `GET /api/track?block=44-07`

### `GET /api/result?block=44-07`

Used for polling when first request returns `pending`.

## Example cURL

```bash
curl -s -X POST http://127.0.0.1:7860/api/chat \
  -H "content-type: application/json" \
  --data '{"message":"44-07"}'
```

## Deployment (Hugging Face Spaces)

- Space SDK: `Docker`
- Exposed port: `7860`
- Uses `Dockerfile` and `npm start`

## Author

Omar Khattab
