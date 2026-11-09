import type { AccountId, SimulationState } from "./types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return result as T;
}

export type PaymentRequest = {
  kind: "payment" | "transfer" | "repayment";
  source: AccountId;
  amount: number;
  reference: string;
  beneficiary?: string;
  destination?: AccountId;
};

export function fetchState() {
  return requestJson<SimulationState>("/api/state");
}

export function submitPayment(payment: PaymentRequest) {
  return requestJson<SimulationState>("/api/payments", {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

export function updateCard(update: { frozen?: boolean; dailyLimit?: number }) {
  return requestJson<SimulationState>("/api/card", {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function resetState() {
  return requestJson<SimulationState>("/api/reset", { method: "POST" });
}

export async function fetchStatement(account?: AccountId) {
  const query = account ? `?account=${account}` : "";
  const response = await fetch(`/api/statements${query}`);
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null);
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : `Statement download failed (${response.status}).`;
    throw new Error(message);
  }
  return response.blob();
}
