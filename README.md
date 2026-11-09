# Nexus Bank

A browser-based Kenyan banking simulation built with React, TypeScript, Vite, and a local Node.js API. It uses fictional account data in Kenyan shillings (KES); it does not connect to a real bank or move real money.

## Project structure

```text
Nexus_Bank/
├── .gitignore
├── index.html              # Browser entry point
├── package.json            # Dependencies and commands
├── package-lock.json        # Locked npm dependency versions
├── tsconfig.json            # TypeScript settings
├── README.md
├── .vscode/
│   └── launch.json          # Existing VS Code debug configuration
├── vite.config.js          # Proxies browser API requests to the local server
├── server/
│   ├── index.mjs           # HTTP API and server-side banking rules
│   └── initial-state.mjs   # Starting accounts and transactions
└── src/
    ├── main.tsx            # React application entry point
    ├── App.tsx             # Banking pages, forms, and interface
    ├── api.ts              # Browser-to-server API calls
    ├── types.ts            # Shared frontend account and transaction types
    └── styles.css          # Layout, responsive styles, and components
```

## Run locally

Install Node.js LTS (npm is included), open two terminals in this folder, and run:

```powershell
npm install
npm run server
```

In the second terminal, start the browser app:

```powershell
npm run dev
```

Open the local address printed by Vite. Keep both terminals running. To create a production build, run `npm run build`.

## Available flows

- View fictional everyday, savings, and credit balances.
- Pay a beneficiary, transfer between accounts, and repay simulated credit.
- Review a payment before confirming it; reject invalid amounts and insufficient funds.
- Freeze or unfreeze the bank card and change its daily limit.
- Filter account activity and download CSV statements.
- Reset local balances and transaction history to their starting values.

The API listens on `127.0.0.1:3001`; Vite proxies `/api` requests to it. Account changes persist on the server in `data/state.json` and remain after the browser is closed. **Reset simulation** restores the starting data. This local server has no authentication and is intended only for the local simulation; it does not connect to a real bank or move real money. Search, sign-in, and live bank connectivity are not implemented.

## API routes

- `GET /` or `GET /api` returns the API status and available routes.
- `GET /api/health` and `GET /api/state`
- `POST /api/payments` with `kind`, `source`, `amount`, and the beneficiary or destination account
- `PATCH /api/card` with `frozen` or `dailyLimit`
- `POST /api/reset`
- `GET /api/statements` (optionally `?account=everyday` or `?account=savings`)
