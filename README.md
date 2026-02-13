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

Live OC Transpo helper tool that takes a **block number** (example: `44-07`) and returns the active **bus number(s)** and latest **location text** in a chat-style interface.

## Quick Link

- Hugging Face App: https://huggingface.co/spaces/OmarLKhattab/OC_Bus_Tracker

## How To Use

1. Open the app link above.
2. Enter a block in the exact format used operationally.
3. Press **Track Block**.
4. Read the returned bus number(s) and location line.

## Block Format Rule (Important)

- `44-07` works
- `44-7` does **not** work

Use leading zeroes where needed to match the standard block format.

## Testing Notice

This project is still under testing. Use it as a **helping tool** and do not fully depend on it for operational decisions yet.

## Local Run

```bash
npm install
npm start
```

Open: `http://localhost:7860`

## API Example

```bash
curl -s -X POST http://127.0.0.1:7860/api/chat \
  -H "content-type: application/json" \
  --data '{"message":"44-07"}'
```

## Screenshot Guide

Use these three screenshots in your project post/readme to explain expected behavior:

1. **Correct Input (works):** block entered as `44-07` and returns bus/location.
2. **Incorrect Input (format issue):** `44-7` (missing leading zero) shows an error.
3. **No Bus Assigned Yet:** block exists but no bus is assigned yet, so it returns a no-bus-found message.

### 1) Correct Input (`44-07`)
![Correct input example](assets/screenshots/correct-input-44-07.png)

### 2) Incorrect Input (`44-7`)
![Incorrect input example](assets/screenshots/incorrect-input-44-7.png)

### 3) No Bus Assigned Yet
![No bus assigned example](assets/screenshots/no-bus-assigned.png)
