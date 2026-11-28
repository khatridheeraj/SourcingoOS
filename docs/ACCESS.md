# Who sees what

Every line here is held by the database (row-level security and guarded functions), not only hidden on screen.
The owner changes a person's role and switches on Team. Three switches exist: **Money**, **Download data** and
**Buyer details**. An **assistant merchandiser** is a Merchandiser with Buyer details switched off.

| | Owner | Manager | Merchandiser | Assistant merchandiser | Accounts | Quality | Buyer's page | Factory's page |
|---|---|---|---|---|---|---|---|---|
| Orders, styles, TNA, samples, team notes | Change | Change | Change | Change | Change | See, enter done dates | Own orders' progress | Own POs and steps |
| Buyer shown as | Name | Name | Name | Code only | Name | Code only | Itself | Never |
| Factory rate, factory POs (send for approval) | Yes | Yes | Yes | Yes | Yes | No | No | Own POs |
| Approve a factory PO | Yes | No | No | No | No | No | No | Accepts it |
| Selling price, order value, margin | Yes | Yes | Yes | No | Yes | No | No | No |
| Buyers pages, contacts, buyer links, weekly buyer updates | Yes | Yes | Yes | No | Yes | No | Own | No |
| Buyer's messages on an order | Yes | Yes | Yes | No | Yes | No | Own | No |
| Buyer emails, buyer PO files, inquiries, costings, Leads, Our record | Yes | Yes | Yes | No | Yes | No | Own asks | No |
| Emails from unknown senders | Yes | No | No | No | No | No | No | No |
| Dispatch, Goods with us, challan, packing list, export papers, shipment tracking | Yes | Yes | Yes | No | Yes | No | Own shipments | No |
| E-way bill limits (Goods): see / change | Change | See | See | No | See | No | No | No |
| Guarantee claims | Decide | Decide | Decide | No | Decide | Read | Raise own | No |
| QC checks | Record | See | See | See | See | Record | Final QC photos | Own |
| Factories, Style catalogue, Markers, Numbers report | Yes | Yes | Yes | Yes | Yes | No (Visit plan instead) | No | Own profile |
| Week and Team reports | Yes | Yes | No | No | No | No | No | No |
| Money: payments, bills, cheques, Tally, cash ahead (switch) | Yes | Off | Off | Off | On | No | Own invoices | Own bills |
| Download data (switch); Buyers and Inquiries sheets need Buyer details | Yes | Off | Off | Off | On | No | No | No |
| Team, Activity log, Team notes | Yes | No | No | No | No | No | No | No |

"Off" and "On" are each switch's starting point; the owner can change it for any one person.
History follows the same lines: without Buyer details there is no history of buyer records, order lines (they carry
the selling price) or dispatches. The morning brief, the bell and the evening email use each person's own switches.

Where it is enforced: `my_perm()` / `perm_for()` and `can_see_buyers()` (migrations 0118 and 0126); tests in
`supabase/tests/bell_permissions.sql` and `supabase/tests/buyer_details.sql`; the screen crawl signs in as every role,
including the assistant (`e2e/crawl.mjs`, role `asst`), and fails if a buyer's name, a selling price or a buyer page
reaches the assistant.
