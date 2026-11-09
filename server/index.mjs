import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialState } from "./initial-state.mjs";

const port = Number(process.env.PORT ?? 3001);
const databasePath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
const accountNames = { everyday: "Everyday account", savings: "GoalSave" };
const maxBodyBytes = 16 * 1024;
let state;
let mutationQueue = Promise.resolve();

function isAccountId(value) {
  return value === "everyday" || value === "savings";
}

function parseAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  if (cents < 1) return null;
  return Math.abs(value * 100 - cents) < 1e-7 ? cents / 100 : null;
}

function isValidSavedState(saved) {
  return Boolean(
    saved &&
    typeof saved === "object" &&
    saved.balances &&
    typeof saved.balances.everyday === "number" &&
    Number.isFinite(saved.balances.everyday) &&
    saved.balances.everyday >= 0 &&
    typeof saved.balances.savings === "number" &&
    Number.isFinite(saved.balances.savings) &&
    saved.balances.savings >= 0 &&
    typeof saved.cardFrozen === "boolean" &&
    typeof saved.cardLimit === "number" &&
    Number.isFinite(saved.cardLimit) &&
    saved.cardLimit >= 1 &&
    typeof saved.creditBalance === "number" &&
    Number.isFinite(saved.creditBalance) &&
    saved.creditBalance >= 0 &&
    saved.creditBalance <= 50000 &&
    Array.isArray(saved.transactions) &&
    saved.transactions.every((transaction) =>
      transaction &&
      typeof transaction.id === "string" &&
      isAccountId(transaction.accountId) &&
      typeof transaction.name === "string" &&
      typeof transaction.detail === "string" &&
      typeof transaction.amount === "number" &&
      Number.isFinite(transaction.amount) &&
      typeof transaction.createdAt === "string",
    ),
  );
}

function escapeCsv(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function saveState(nextState) {
  const directory = dirname(databasePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(nextState, null, 2), "utf8");
    await rename(temporaryPath, databasePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

async function mutateState(operation) {
  const result = mutationQueue.then(async () => {
    const nextState = operation(state);
    await saveState(nextState);
    state = nextState;
    return structuredClone(state);
  });
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";

  if (url.pathname.startsWith("/api/") && !["GET", "POST", "PATCH"].includes(method)) {
    response.writeHead(405, { Allow: "GET, POST, PATCH" });
    response.end();
    return;
  }

  if (method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
    sendJson(response, 200, {
      name: "Nexus Bank API",
      status: "ok",
      currency: "KES",
      endpoints: {
        health: "GET /api/health",
        state: "GET /api/state",
        payments: "POST /api/payments",
        card: "PATCH /api/card",
        reset: "POST /api/reset",
        statements: "GET /api/statements",
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, state);
    return;
  }
  if (method === "POST" && url.pathname === "/api/payments") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(response, 400, { error: "Request body must be a JSON object." });
      return;
    }
    const kind = body.kind;
    const source = body.source;
    const amount = parseAmount(body.amount);
    const reference = typeof body.reference === "string" && body.reference.trim()
      ? body.reference.trim().slice(0, 80)
      : "Payment";
    if (!["payment", "transfer", "repayment"].includes(kind) || !isAccountId(source) || amount === null) {
      sendJson(response, 400, { error: "Choose an account, action and valid amount." });
      return;
    }
    const destination = body.destination;
    if (kind === "transfer" && (!isAccountId(destination) || destination === source)) {
      sendJson(response, 400, { error: "Choose a different destination account." });
      return;
    }
    if (kind === "payment" && (typeof body.beneficiary !== "string" || !body.beneficiary.trim() || body.beneficiary.length > 100)) {
      sendJson(response, 400, { error: "Enter a beneficiary name or account number." });
      return;
    }
    try {
      const nextState = await mutateState((current) => {
        if (amount > current.balances[source]) {
          const error = new Error("Your available balance is not enough for this payment.");
          error.status = 409;
          throw error;
        }
        if (kind === "repayment" && amount > current.creditBalance) {
          const error = new Error("That amount is more than your outstanding credit balance.");
          error.status = 409;
          throw error;
        }
        const now = new Date();
        const time = new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit" }).format(now);
        const paymentName = kind === "payment"
          ? body.beneficiary.trim().slice(0, 100)
          : kind === "repayment"
            ? "Credit repayment"
            : `Transfer to ${accountNames[destination]}`;
        const created = (accountId, name, transactionAmount) => ({
          id: randomUUID(),
          accountId,
          name,
          detail: `${reference} · Today, ${time}`,
          amount: transactionAmount,
          category: "transfer",
          createdAt: now.toISOString(),
        });
        const next = structuredClone(current);
        next.balances[source] = Math.round((next.balances[source] - amount) * 100) / 100;
        next.transactions.unshift(created(source, paymentName, -amount));
        if (kind === "transfer") {
          next.balances[destination] = Math.round((next.balances[destination] + amount) * 100) / 100;
          next.transactions.unshift(created(destination, `Transfer from ${accountNames[source]}`, amount));
        }
        if (kind === "repayment") {
          next.creditBalance = Math.round((next.creditBalance - amount) * 100) / 100;
        }
        return next;
      });
      sendJson(response, 200, nextState);
    } catch (error) {
      if (error.status) sendJson(response, error.status, { error: error.message });
      else throw error;
    }
    return;
  }
  if (method === "PATCH" && url.pathname === "/api/card") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(response, 400, { error: "Request body must be a JSON object." });
      return;
    }
    const hasFrozen = Object.prototype.hasOwnProperty.call(body, "frozen");
    const hasLimit = Object.prototype.hasOwnProperty.call(body, "dailyLimit");
    if (
      (!hasFrozen && !hasLimit) ||
      (hasFrozen && typeof body.frozen !== "boolean") ||
      (hasLimit && (typeof body.dailyLimit !== "number" || !Number.isFinite(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 100000))
    ) {
      sendJson(response, 400, { error: "Provide a card freeze setting or a daily limit between KSh 1 and KSh 100,000." });
      return;
    }
    const nextState = await mutateState((current) => ({
      ...current,
      ...(typeof body.frozen === "boolean" ? { cardFrozen: body.frozen } : {}),
      ...(typeof body.dailyLimit === "number" ? { cardLimit: Math.round(body.dailyLimit * 100) / 100 } : {}),
    }));
    sendJson(response, 200, nextState);
    return;
  }
  if (method === "POST" && url.pathname === "/api/reset") {
    const nextState = createInitialState();
    try {
      await mutateState(() => nextState);
      sendJson(response, 200, structuredClone(nextState));
    } catch (error) {
      throw error;
    }
    return;
  }
  if (method === "GET" && url.pathname === "/api/statements") {
    const account = url.searchParams.get("account");
    if (account && !isAccountId(account)) {
      sendJson(response, 400, { error: "Unknown account." });
      return;
    }
    const rows = state.transactions.filter((transaction) => !account || transaction.accountId === account);
    const csv = [
      ["Date", "Account", "Description", "Reference", "Amount (KES)"],
      ...rows.map((transaction) => [
        transaction.createdAt,
        accountNames[transaction.accountId],
        transaction.name,
        transaction.detail,
        transaction.amount.toFixed(2),
      ]),
    ].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nexus-${account ?? "all-accounts"}-statement.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(csv);
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function start() {
  try {
    const saved = JSON.parse(await readFile(databasePath, "utf8"));
    if (!isValidSavedState(saved)) {
      throw new Error("Saved simulation data has an invalid shape. Rename data/state.json to reset it.");
    }
    state = saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = createInitialState();
    await saveState(state);
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error("API request failed:", error);
      if (!response.headersSent) sendJson(response, error.status ?? 500, { error: error.status ? error.message : "The server could not complete the request." });
      else response.destroy(error);
    });
  });
  server.on("error", (error) => {
    console.error("Bank simulation server error:", error);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Nexus Bank API listening at http://127.0.0.1:${port}`);
  });
}

void start().catch((error) => {
  console.error("Could not start the bank simulation server:", error);
  process.exitCode = 1;
});
