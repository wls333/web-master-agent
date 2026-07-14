import { id } from "../util/ids.mjs";

export function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": payload?.requestId || id("req")
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function ok(res, payload) {
  json(res, 200, payload);
}

export function created(res, payload) {
  json(res, 201, payload);
}

export function accepted(res, payload) {
  json(res, 202, payload);
}

export function error(res, status, code, message, details = []) {
  json(res, status, {
    error: { code, message, details },
    requestId: id("req")
  });
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
