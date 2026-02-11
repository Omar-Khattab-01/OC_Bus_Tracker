FROM node:20-bookworm

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Install Chromium and required system dependencies for Playwright.
RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
ENV PORT=7860
ENV HEADLESS=1

EXPOSE 7860

CMD ["npm", "start"]
