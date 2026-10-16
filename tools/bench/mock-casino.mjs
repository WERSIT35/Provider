// Mock casino wallet for the bench: answers instantly (0 ms casino-side work), so any
// latency measured through it is the platform's own cost of wallet calls.
// It does not verify signatures. With CASINO_LOG set it appends every money call to
// an append-only JSONL ledger, which tools/bench/chaos.mjs compares with ours.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

const PORT = Number(process.env.CASINO_PORT ?? 8091);
const LOG = process.env.CASINO_LOG;
const balances = new Map();

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const action = req.url.split("/").pop();
    const j = body ? JSON.parse(body) : {};
    const k = `${j.operatorPlayerId}:${j.currency}`;
    if (!balances.has(k)) balances.set(k, 1e9);
    if (LOG && action !== "balance") {
      appendFileSync(LOG, JSON.stringify({ action, roundRef: j.roundRef, amount: j.amount, key: j.idempotencyKey, orig: j.originalIdempotencyKey }) + "\n");
    }
    let out;
    if (action === "balance") out = { amount: balances.get(k), currency: j.currency };
    else if (action === "rollback") out = { operatorTxRef: randomUUID(), status: "rolled_back" };
    else {
      balances.set(k, balances.get(k) + (action === "credit" ? j.amount : -j.amount));
      out = { operatorTxRef: randomUUID(), status: "confirmed", balanceAfter: { amount: balances.get(k), currency: j.currency } };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock casino :${PORT}`));
