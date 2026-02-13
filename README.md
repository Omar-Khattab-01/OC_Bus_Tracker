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

## Screenshot Placeholders

Replace these placeholders with your actual screenshots.

```md
![App Home - Placeholder](PLACEHOLDER_HOME_SCREENSHOT_URL)
![App Result - Placeholder](PLACEHOLDER_RESULT_SCREENSHOT_URL)
```

Or if you store images in this repo:

```md
![App Home](assets/screenshots/home.png)
![App Result](assets/screenshots/result.png)
```
