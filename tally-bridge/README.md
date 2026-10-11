# Sourcingo Tally reader

Reads TallyPrime into Sourcingo OS. It runs on the PC where Tally runs, because
Tally only answers on that machine, and it **only reads**: it never creates,
changes or cancels anything in Tally.

**What it reads, every 15 minutes while Tally is open**

- Every ledger with its closing balance and GSTIN, so the app shows what each buyer owes and what we owe each factory.
- Stock items with quantity and value.
- Vouchers from the "Read vouchers from" date (or the start of last financial year): sales, credit notes, receipts,
  purchases and payments, with the bills each one is set against. Cancelled and optional vouchers are skipped.

**What the app does with it** (the Tally page, owner and Accounts only)

- Links each buyer and factory to the Tally ledger with the same name ("M/s Ozia Pvt. Ltd." matches "Ozia"); Accounts can correct any link.
- Lists invoices and credit notes that are only in Tally, and adds the ticked ones to Payments in one click.
- Lists entries whose amount or buyer differs, entries only in Payments, and cleared cheques with no receipt in Tally.
- Shows each buyer's Tally balance beside what Payments says is left to collect.

Open orders, styles, TNA and samples aren't in Tally, so they don't come from here.

## Install (Windows, once)

1. In TallyPrime, press **F1 (Help) › Settings › Connectivity › Client/Server configuration**. Set **TallyPrime acts as** to **Both** and the port to **9000**. Keep the company open.
2. In Sourcingo OS, open **Tally › Setup**, enter the company name exactly as Tally shows it, tick **Read Tally**, save, and press **Make sync key**.
3. Copy this folder to the Tally PC, open PowerShell in it and run:
   `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1`
   It installs Node.js if needed, asks for the sync key, runs one read and sets the reader to start at sign-in.

`sync.log` in this folder records each read.

## For developers

- `node sync.mjs --once` runs one round. `npm test` runs the tests; with `PGHOST`/`PGUSER` set they also run end to end against the real database functions.
- The reader signs in with the sync key only (no user account). The database checks the key's hash in both `tally_bridge_*` functions, the only ones a signed-out caller can run.
- `test/fake-tally.mjs` answers like Tally's XML server and records any write, so the tests prove nothing is written.
