function transaction(id, daysAgo, hour, minute, name, reference, amount, category) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  const time = new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit" }).format(date);
  const day = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(date);
  const dateLabel = daysAgo === 0 ? `Today, ${time}` : daysAgo === 1 ? "Yesterday" : day;
  return {
    id,
    accountId: "everyday",
    name,
    detail: `${reference} · ${dateLabel}`,
    amount,
    category,
    createdAt: date.toISOString(),
  };
}

export function createInitialState() {
  return {
    balances: { everyday: 18450.75, savings: 12480.2 },
    cardFrozen: false,
    cardLimit: 15000,
    creditBalance: 12850,
    transactions: [
      transaction("seed-1", 0, 10, 42, "Woolworths Food", "Groceries", -842.5, "shopping"),
      transaction("seed-2", 0, 8, 15, "Monthly salary", "Salary", 32500, "salary"),
      transaction("seed-3", 1, 18, 30, "The Living Room", "Dining", -365, "food"),
      transaction("seed-4", 2, 17, 20, "Uber trip", "Transport", -128.4, "car"),
      transaction("seed-5", 3, 12, 5, "Checkers Sixty60", "Groceries", -629.99, "shopping"),
    ],
  };
}
