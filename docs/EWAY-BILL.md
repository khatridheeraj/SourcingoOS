# E-way bill: when the app asks for one

Checked 28 Nov 2026. The owner can change every number below on **Goods > E-way bill limits**; the app's rule
(`dispatch_eway_rule`, migration 0132) reads them from `companies.eway_rules`.

## The rule

| Where the lot goes | Needs an e-way bill when the invoice with GST is | Source |
|---|---|---|
| Another state (or not known) | more than Rs 50,000 | Rule 138(1), CGST Rules |
| Elsewhere in Rajasthan (city to city) | more than Rs 1,00,000 | Rajasthan notification F.17(131-Pt-II)ACCT/GST/2017/7713, 24 Mar 2022, from 1 Apr 2022 |
| Inside the same city in Rajasthan | more than Rs 2,00,000 | the same notification |

- **Value** is the consignment value: the invoice value under section 15 *including* CGST, SGST, IGST and cess, without
  exempt goods on the same invoice (Rule 138, Explanation 2). The app uses the invoice's total in Payments.
- "More than": an invoice of exactly the limit needs none.
- Rajasthan's higher limits don't cover tobacco (chapter 24), pan masala (2106), wood (chapter 44) or iron and steel
  (chapter 72); garments and fabric are covered.
- **Always needed, whatever the value**: goods sent by a principal to a job worker in another state, and handicraft goods
  moved inter-state by someone exempt from registration (Rule 138(1), provisos). Our dispatches are sales to buyers, so the
  rule doesn't apply them; the merchandiser taps "It needs an e-way bill" when a lot is one of these.
- **Never needed** in a few cases listed in Rule 138(14), such as a non-motorised conveyance or goods under customs seal; the
  merchandiser marks those "No e-way bill needed for another reason" with the reason.

## How the app behaves

- When a lot is invoiced, its value is checked against the limit for where it goes. Not above: the step shows
  "No e-way bill needed" with the value, the limit and the date checked, and the lot can ship.
- Where it goes is picked on the e-way bill step and remembered for the buyer. Not known counts as another state, the
  strictest limit.
- If Tally made an e-way bill anyway, it is still picked up and shown.
- Changing the limits re-checks every lot that is invoiced and not shipped (not ones marked by hand).

## Sources

- Rule 138, CGST Rules (CBIC): https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter16/rule138_v1.00.html
- E-way bill rules on the portal: https://docs.ewaybillgst.gov.in/documents/EWBRules.pdf
- Rajasthan notification 7713 of 24 Mar 2022: https://taxguru.in/goods-and-service-tax/e-way-bill-limit-extended-rs-2-lac-rajasthan-wef-1st-april-2022.html
