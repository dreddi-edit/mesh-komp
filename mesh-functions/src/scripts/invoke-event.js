#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { processBlobCapsuleEvent } = require("../shared/blob-capsule-processor.cjs");

async function readEventPayload(inputPath = "") {
  if (inputPath) {
    const absolutePath = path.resolve(process.cwd(), inputPath);
    return JSON.parse(await fs.promises.readFile(absolutePath, "utf8"));
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const payload = Buffer.concat(chunks).toString("utf8").trim();
  if (!payload) {
    throw new Error("Provide an Event Grid payload via stdin or pass a JSON file path.");
  }
  return JSON.parse(payload);
}

async function main() {
  const payload = await readEventPayload(process.argv[2] || "");
  const event = Array.isArray(payload) ? payload[0] : payload;
  const result = await processBlobCapsuleEvent(event, {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
