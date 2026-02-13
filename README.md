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

I built this project as a live OC Transpo helper tool. It takes a **block number** (example: `44-07`) and returns the active **bus number(s)** and latest **location text** in a chat-style interface.

## Live App

- Hugging Face Space: https://huggingface.co/spaces/OmarLKhattab/OC_Bus_Tracker

## Usage

1. Enter a block number in the standard format.
2. Submit with **Track Block**.
3. Read the returned bus number(s) and location line.

## Block Format

- `44-07` works
- `44-7` is automatically mapped to `44-07`

The app now normalizes the second part when needed (for example `-7` -> `-07`) to reduce input mistakes.

## Testing Status

This project is still under testing. It should be used as a **helping tool**, not as a fully authoritative operational source.

## Local Run

```bash
npm install
npm start
```

Local URL:

`http://localhost:7860`

## API Example

```bash
curl -s -X POST http://127.0.0.1:7860/api/chat \
  -H "content-type: application/json" \
  --data '{"message":"44-07"}'
```

## Example Screens

These screenshots show the expected behavior:

1. Correct input (`44-07`) returns bus/location.
2. Input without leading zero (`44-7`) is auto-mapped to the canonical block (`44-07`).
3. No-bus-assigned case returns a no-bus-found message.

### 1) Correct Input (`44-07`)
![Correct input example](assets/screenshots/correct-input-44-07.png)

### 2) Auto-Mapped Input (`44-7` -> `44-07`)
![Auto-mapped input example](assets/screenshots/incorrect-input-44-7.png)

### 3) No Bus Assigned Yet
![No bus assigned example](assets/screenshots/no-bus-assigned.png)
