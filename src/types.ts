export type AccountId = "everyday" | "savings";

export type Transaction = {
  id: string;
  accountId: AccountId;
  name: string;
  detail: string;
  amount: number;
  category: "shopping" | "food" | "car" | "salary" | "transfer";
  createdAt: string;
};

export type SimulationState = {
  balances: Record<AccountId, number>;
  cardFrozen: boolean;
  cardLimit: number;
  creditBalance: number;
  transactions: Transaction[];
};
