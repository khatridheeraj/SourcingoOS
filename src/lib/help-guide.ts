// The written guide behind Help. Every answer here is about this app as it works today, in the words on its screens.
// Help finds answers by matching the words of a question (English, Hindi or Hinglish) against these topics, for free.
// When a question finds nothing, it is logged; Claude reads those every morning and adds the missing answers here.
import type { Role } from "@/lib/auth-roles";

export type Audience = "staff" | "factory" | "buyer";
export type Topic = {
  id: string;
  who: Audience;
  // The question as people ask it, and the answer as short steps.
  q: string;
  a: string[];
  // For factories: the same in Hindi.
  hi?: { q: string; a: string[] };
  // Other words people use for it, including Hinglish.
  words?: string;
  link?: { href: string; label: string };
  // Screens where it is suggested (path prefixes; "/" means the Orders list only).
  pages?: string[];
  // Staff roles it is for. Leave out for everyone.
  roles?: Role[];
};

const ORDERS_TEAM: Role[] = ["owner", "manager", "merchandiser", "accounts"];
const MONEY: Role[] = ["owner", "accounts"];

export const TOPICS: Topic[] = [
  // ---------------------------------------------------------------- getting around
  { id: "sign-in", who: "staff", q: "How do I sign in?",
    a: ["Open sourcingo-os.vercel.app and type your work email.", "Open the email from Sourcingo on the same phone and tap the link. There is no password.",
        "No email after a minute? Look in Spam. If it still isn't there, ask the owner to check that your email is added in Team."],
    words: "login log in password otp link email not coming signin" },
  { id: "install", who: "staff", q: "How do I put the app on my phone's home screen?",
    a: ["Android (Chrome): open the app, tap the ⋮ menu, then Add to Home screen or Install app.",
        "iPhone (Safari): tap the Share button, then Add to Home Screen.", "It then opens full screen like any other app."],
    words: "install app icon shortcut home screen download apk mobile" },
  { id: "home", who: "staff", q: "What does the Home screen show?",
    a: ["To do: what is late, overdue or blocking work, red first. Tap a row to open it.", "Shipping next: open orders by ship date, with steps done against plan.",
        "Tidy up: orders shipped long ago but still open, so they count as late. Mark them shipped.", "Where the styles are: each style by the furthest step it has done."],
    words: "today dashboard main screen todo to do list red", link: { href: "/today", label: "Open Home" }, pages: ["/today"] },
  { id: "brief", who: "staff", q: "What is the morning brief?",
    a: ["Brief shows today's ship dates at risk, overdue steps, what is due in the next 2 days, and what is waiting on you or a factory.",
        "It comes by email at 9 am, Monday to Saturday.", "Send to a WhatsApp group shares it with the team in one tap. Cheque amounts are left out."],
    words: "brief morning summary email 9am whatsapp group daily report", link: { href: "/brief", label: "Open Brief" }, pages: ["/brief", "/today"] },
  { id: "access", who: "staff", q: "Why can't I see a screen, prices or payments?",
    a: ["Each role sees what it needs. Quality sees orders and QC but no prices or payments.",
        "Payments and Tally are for Accounts and the owner. Team and the Activity log are for the owner.",
        "Real buyer names are shown to the team. Factory logins never see buyers or prices.", "If you need more access, send Dheeraj a note from here."],
    words: "permission access cannot see missing menu hidden rate price role not showing" },
  { id: "dark", who: "staff", q: "Can I use dark mode?",
    a: ["The app follows your phone. Turn on dark mode in the phone's display settings and the app turns dark too."],
    words: "dark mode night theme black" },

  // ---------------------------------------------------------------- orders
  { id: "next-step", who: "staff", q: "What do I do next on an order?",
    a: ["Open the order. The card at the top shows its road: Factory, Plan, PO, Make, Final QC, Ship. The ticked stages are done.",
        "Under it, Next step says the one thing to do now, with its button. Tap it and the right sheet or section opens.",
        "When it says Waiting, someone else has the next move (the owner's approval, the factory or Quality).",
        "Orders also counts orders at each stage at the top. Tap a stage to see only those, each with its next step."],
    words: "next step what next kya karna hai aage kya process flow stage pipeline where is order stuck kahan", link: { href: "/", label: "Open Orders" }, pages: ["/", "/orders/"] },
  { id: "start-new", who: "staff", q: "Where do I start something new?",
    a: ["Tap + New (in the middle of the bottom bar on a phone, at the top of the menu on a computer).",
        "It starts a new order, an inquiry or a buyer PO from a file, and for Accounts a cheque or an invoice."],
    words: "new add create naya start begin plus button", pages: ["/today"] },
  { id: "new-order", who: "staff", roles: ORDERS_TEAM, q: "How do I add a new order?",
    a: ["Go to Orders and tap New order.", "Pick the buyer, then enter the buyer PO number, PO date and ship date as printed on the PO.",
        "Add each style: style no., quantity, buyer rate, factory and factory rate. Tap Add style for more.",
        "Tap Save order. If the PO number or a style looks like one already entered, check the warning, then Save anyway if it is right."],
    words: "create order add po enter order naya order new po entry", link: { href: "/orders/new", label: "New order" }, pages: ["/", "/orders/new"] },
  { id: "delete-po", who: "staff", roles: ORDERS_TEAM, q: "A PO was added by mistake. How do I delete it?",
    a: ["Only the owner can delete an order. Ask Dheeraj, or if you are the owner: open the order, tap Details, then Delete PO at the end and say why.",
        "It leaves every screen and its PO number is free to add again. The owner can bring it back from Orders, Cancelled, Deleted POs.",
        "Still on Buyer POs and not an order yet? Tap Set aside, not a new PO instead."],
    words: "delete po remove po wrong po mistake galti se po hatao delete order remove order duplicate entered twice", pages: ["/", "/pos"] },
  { id: "po-to-order", who: "staff", roles: ORDERS_TEAM, q: "How do I turn an incoming buyer PO into an order?",
    a: ["Open Buyer POs and tap the PO.", "Check before adding lists what the reader couldn't find. Fix those in the form below it.",
        "Tap the add button at the bottom to make the order.", "Not a PO (a reminder, an invoice)? Tap Set aside, not a new PO. Read wrongly? Tap Read again."],
    words: "incoming po email po convert add order from po check po buyer po read", link: { href: "/pos", label: "Open Buyer POs" }, pages: ["/pos"] },
  { id: "po-pickup", who: "staff", roles: ORDERS_TEAM, q: "How do buyer POs come into the app?",
    a: ["POs emailed to dheerajkhatri@ and merchandiser@sourcingo.in are picked up every 10 minutes and appear in Buyer POs.",
        "You can also tap Add PO from a file on Buyer POs.", "Excel, CSV and PDF POs are read for free. For scans and photos, type the details in the form."],
    words: "po pickup gmail mail email auto import upload file excel pdf scan", link: { href: "/pos", label: "Open Buyer POs" }, pages: ["/pos"] },
  { id: "po-pdf", who: "staff", roles: ORDERS_TEAM, q: "Where is the buyer's PO PDF for an order, and how do I make the factory PO PDF?",
    a: ["Every order shows PO PDF next to its ship date. Tap it to open the buyer's PO. A PO that came by email is there by itself.",
        "No buyer PO yet? Tap it, then Add the PO file, and pick the PDF, Excel or photos of its pages. Details has Open and Download for each file.",
        "PO came on WhatsApp or by phone? Tap Create PO on Buyer POs (or New order), type it in and attach the buyer's file (a WhatsApp photo or screenshot is fine). Make PO PDF on the order prints a clean PO from what you typed for the buyer to confirm.",
        "A factory PO is sent for approval only once the buyer's PO is on the order. Until then you can still plan and ask the factory.",
        "For the factory: in Styles, tap Draft PO PDF (or Factory PO once approved) on the factory's row. It's in our own PO format with the vendor agreement's terms; Print or save as PDF if you need a file.",
        "Every style needs its photo on the PO: the factory works from the picture. Tap + Add photo in the Image column.",
        "When the plan is complete, every style has its photo and the factory's email is in PO details, tap Send PO for approval. Dheeraj checks it and taps Approve and send PO: the PO is emailed to the factory from his Gmail within the hour (Send the PO again resends it); the factory accepts by replying \"Accepted\" or tapping Accept on the PO link. No signature. We follow up every 2 hours (9 am to 9 pm, Mon to Sat) until they accept; if they reply with a question, follow-ups pause until you answer and send again. Accepted on the phone? Tap Mark accepted.",
        "Edit PO details on that page sets the PO number (like SO/172/2026), the delivery line (like half lot 15/11, rest 20/11) and the factory's address, GSTIN, mobile and email, kept for its next POs."],
    words: "po pdf buyer po file accept accepted email factory follow up photo image terms conditions agreement gstin delivery date po number original po attach upload download factory po print pdf whatsapp purchase order create po make po new po type po directly", pages: ["/orders"] },
  { id: "held-po", who: "staff", roles: ORDERS_TEAM, q: "Why is a PO email held as 'Unknown sender'?",
    a: ["Emails from an address the app doesn't know as a buyer are held, so private mail doesn't become an order by mistake.",
        "Open it, pick the buyer it is from and accept it. It is then read like any other PO."],
    words: "unknown sender held email not read accept sender", pages: ["/pos"] },
  { id: "edit-order", who: "staff", roles: ORDERS_TEAM, q: "How do I change an order's quantity, rate, styles or dates?",
    a: ["Open the order and go to Details.", "Change what you need: buyer PO, dates, styles, quantities, rates or factory.", "Tap Save changes. Every change is kept in History."],
    words: "edit order change quantity qty rate style remove style correct order update order badalna", pages: ["/orders/"] },
  { id: "find-order", who: "staff", q: "How do I find an order?",
    a: ["On Orders, type a PO number, style, buyer or factory in the search box.", "Use the tabs to see Open, Late, Shipped or Cancelled orders."],
    words: "search find order look for style number dhundna", link: { href: "/", label: "Open Orders" }, pages: ["/"] },
  { id: "quick-update", who: "staff", q: "How do I mark steps done quickly?",
    a: ["Tap Update on a Home row, or Update progress on the order.", "Next steps: each step shows with its styles ticked. Untick any style not done yet, pick Today, Yesterday or a day, and tap Mark done.",
        "Catch up: when the app is behind the factory, tap the last step that's finished. Every step before it is marked done too, dated on its target (or today if you switch that off)."],
    words: "update done mark tna step progress catch up behind all styles bulk quick", pages: ["/today", "/orders"] },
  { id: "start-production", who: "staff", roles: ORDERS_TEAM, q: "How do I start production on a new order?",
    a: ["Tap Start production on Home or on the order.", "Add anything missing (factory, factory rate, a new ship date if the old one passed). Set the buffer: the plan for every step and every style is filled in for you.",
        "Pick 'The factory agreed to these dates' and send it to the owner for approval, or ask the factory for its own dates. Once approved, the PO is emailed to the factory, production has started and steps can be marked done."],
    words: "start production plan tna targets fill new order lock release factory po begin", pages: ["/today", "/orders"] },
  { id: "chase", who: "staff", roles: ORDERS_TEAM, q: "How do I chase a factory?",
    a: ["Tap Chase on a Home row. WhatsApp opens with the message written: what is late and what is next on each style.", "Send it. The row then shows Chased, so the team knows it was done today."],
    words: "chase factory whatsapp follow up remind status photos late", pages: ["/today"] },
  { id: "buyer-update", who: "staff", roles: ORDERS_TEAM, q: "How do I send a buyer an update on their orders?",
    a: ["Open Updates in the menu (or Chase and update on Home) and pick Buyers.", "Tap Check to read the message, change anything you like, then Send opens WhatsApp, or Copy to paste into an email. Factory names and rates are never in it.",
        "Factories tells you which factories are behind; one Chase each sends them every late order in one message."],
    words: "buyer update weekly status report send whatsapp email updates chase all factories", pages: ["/updates", "/today"] },
  { id: "search", who: "staff", q: "How do I find an order, style or PO quickly?",
    a: ["Tap the search icon at the top (on a computer, press Ctrl K or ⌘K, or /).", "Type any part of an order number, buyer PO, style, colour, buyer or factory. Tap a result to open it."],
    words: "search find look up order po style colour buyer factory quick", pages: [] },
  { id: "old-order", who: "staff", roles: ORDERS_TEAM, q: "An old order shipped before we used the app. How do I close it?",
    a: ["On Home under Tidy up, tap Mark shipped on the order.", "Write how it shipped, for example 'Shipped end of July by road', and tap Close it. Nothing needs to go in Dispatch."],
    words: "old order shipped before close july august stuck late tidy", pages: ["/today"] },
  { id: "ship-date", who: "staff", roles: ORDERS_TEAM, q: "The ship date moved. How do I change it?",
    a: ["Open the order and go to Ship date.", "Enter the New ship date. It replaces the buyer's date on every list, and the buyer's own date is kept for reference.",
        "If the PO itself changed, change the ship date in Details instead."],
    words: "ship date change delivery date revised date extend delay postpone", pages: ["/orders/"] },
  { id: "mark-shipped", who: "staff", roles: ORDERS_TEAM, q: "How do I mark an order shipped?",
    a: ["Open the order and tap Mark shipped, then confirm.", "Every style's latest final QC must have passed first. If one hasn't, Quality records it in QC.",
        "Shipped orders move to the Shipped tab on Orders."],
    words: "shipped close order complete order done finish order mark shipped", pages: ["/orders/", "/today"] },
  { id: "cancel-order", who: "staff", roles: ORDERS_TEAM, q: "How do I cancel an order?",
    a: ["Open the order and go to Details.", "Set Status to Cancelled and tap Save changes. Nothing is deleted; it moves to the Cancelled tab."],
    words: "cancel order delete order remove order", pages: ["/orders/"] },
  { id: "share-update", who: "staff", roles: ORDERS_TEAM, q: "How do I send an order update on WhatsApp?",
    a: ["Open the order and tap Share an update.", "Pick the buyer message (no factory names or prices) or ask the factory for today's status and photos.",
        "Change anything you like, then tap WhatsApp, or copy it and paste it in your chat."],
    words: "share whatsapp update buyer status message send update", pages: ["/orders/"] },
  { id: "at-risk", who: "staff", q: "What does 'At risk' or 'likely late' mean?",
    a: ["A late step pushes back every step after it. The app works out when the style will likely be ready.",
        "At risk · about 5 days late means the style will likely be ready 5 days after the ship date unless the factory catches up.", "Chase the late step shown, or move the ship date."],
    words: "at risk late delay red behind plan likely ready slip", pages: ["/", "/today", "/orders/", "/brief"] },
  { id: "samples", who: "staff", roles: ORDERS_TEAM, q: "How do sample approvals work?",
    a: ["Factories send fit, strike off, PP and size-set samples with photos from their panel. They show on Samples under To check.",
        "Check the photos. Tap Send to buyer and add the courier and AWB, or tap Send back with what the factory should fix.",
        "The buyer approves or asks for changes on their page. If the buyer answers by email or WhatsApp, tap Record buyer's answer.",
        "An approval closes that TNA step by itself. Changes go back to the factory for the next round."],
    words: "sample fit pp size set strike off approval approve buyer comments courier awb round resubmit", link: { href: "/samples", label: "Open Samples" }, pages: ["/samples", "/orders/", "/today"] },
  { id: "margin", who: "staff", roles: ORDERS_TEAM, q: "Where do I see an order's margin?",
    a: ["Open the order and go to Margin. It shows the planned sale, cost and margin, before GST and freight.",
        "Earned is the invoice value less the factory bill, for dispatches already invoiced."],
    words: "margin profit earning commission rate difference", pages: ["/orders/"] },

  // ---------------------------------------------------------------- TNA
  { id: "tna", who: "staff", roles: ORDERS_TEAM, q: "How do I plan the TNA for an order?",
    a: ["Open the order and go to Styles. Make sure every style has a factory (in Details).",
        "Set the buffer days for the factory, then tap Fill empty targets. Check the dates, change any you want, and save.",
        "Tap Ask factory for plan. The factory has 24 hours to send its own date for each step in its panel.",
        "If the factory agreed to your targets on the phone or WhatsApp, tap Factory agreed to targets instead.",
        "When every factory date is in and none is later than its target, add every style's photo and tap Send PO for approval. The owner approves it, and the PO is emailed to the factory."],
    words: "tna plan time and action targets planning schedule steps dates target date", pages: ["/orders/"] },
  { id: "fill-targets", who: "staff", roles: ORDERS_TEAM, q: "What does 'Fill empty targets' do?",
    a: ["It fills every empty target date, working back from the target date with the usual days for each step.",
        "Target date = the ship date minus the buffer days. Check the dates, then save. Dates you already set are kept."],
    words: "fill empty targets auto dates standard days buffer", pages: ["/orders/"] },
  { id: "extra-step", who: "staff", roles: ORDERS_TEAM, q: "How do I add an extra step like embroidery?",
    a: ["Open the order, go to Styles and open the style.", "Tap Add step, type its name (for example Embroidery), set its target date and save.",
        "The 15 standard steps are all needed and can't be removed. Extra steps can be added after release too."],
    words: "extra step add step embroidery washing new step custom step", pages: ["/orders/"] },
  { id: "ask-factory", who: "staff", roles: ORDERS_TEAM, q: "How do I ask the factory for its TNA?",
    a: ["Set every target first, then tap Ask factory for plan on the order's Styles.",
        "Send the factory its link (Factory link) or tap Copy plan request and paste it to them.",
        "The factory has 24 hours. After that it shows as critical: chase it, or tap Ask again to restart the 24 hours."],
    words: "ask factory plan request tna factory 24 hours critical chase", pages: ["/orders/"] },
  { id: "release-po", who: "staff", roles: ORDERS_TEAM, q: "How do I release the factory PO?",
    a: ["On the order's Styles, every step needs a factory date that is on or before its target, and every style a factory rate.",
        "Missing before release shows what is still needed. Every style also needs its photo, and the factory its email (Factory PO page, Edit PO details). Then tap Send PO for approval.",
        "The owner checks the PO and taps Approve and send PO: it is emailed to the factory, who accepts by replying \"Accepted\". If the owner sends it back, the reason shows on the order and on Home: fix it and send it again.",
        "After approval the targets are locked; only the owner can move one, with a reason."],
    words: "release po factory po issue po lock owner lock send for lock approval approve send po for approval plan complete sent back create factory po merchandiser", pages: ["/orders/", "/today"] },
  { id: "future-date", who: "staff", roles: ORDERS_TEAM, q: "Why can't I pick a date after today?",
    a: ["A Done date is the day the work was finished, so it can only be today or earlier. Mark a step done on the day it is actually finished.",
        "Targets are the future dates. Before the PO is approved you can set any target. After approval they are locked: tap Locked · Ask to move under the step, write the new date and why, and it goes to the owner, who moves it.",
        "If the whole order will ship later, open Start production (or Production) and give the new ship date with a reason."],
    words: "future date date after today beyond today date not selecting cannot select date unable to select date date picker calendar tomorrow next date target locked move target change target date aage ki date date nahi aa rahi not allowing enter future dates allow future dates select future date", pages: ["/orders/"] },
  { id: "close-short", who: "staff", roles: ORDERS_TEAM, q: "How do I close an order with a short quantity?",
    a: ["Open the order. When part of it has shipped, the next step reads Ship the rest, or close short: tap Open dispatch.",
        "Under the pieces shipped, tap Close short, say why the rest won't go (for example: buyer accepted 2,644 pcs) and tap Close short again.",
        "The order is marked shipped with the quantity actually billed, and the owner sees the reason in the morning brief. Reopening the order undoes it."],
    words: "close short close order close the order short quantity recorded short quantity less quantity balance cancel rest shipped less buyer accepted fewer pieces close the order", pages: ["/orders/"] },
  { id: "factory-email", who: "staff", roles: ORDERS_TEAM, q: "How do I add the factory's email?",
    a: ["Easiest: in Start production, a box for the factory's email shows when it has none. Type it there and send; it is saved with the factory.",
        "Or open the Factory PO page (PO details opens by itself when the email is missing), or go to Factories and tap Edit on that factory.",
        "It is kept for every later PO to that factory. Then tap Send PO for approval: once approved, the PO is emailed there."],
    words: "factory email add factory email add email mail id email id start production send po for approval missing email po details", pages: ["/orders/", "/factories"] },
  { id: "inquiries", who: "staff", roles: ORDERS_TEAM, q: "How do I log a buyer inquiry?",
    a: ["Go to Inquiries and paste the buyer's message (from WhatsApp or email) in the box on top, or type a line like: Uptownie 1200 satin co-ords @450. The buyer, quantity and price fill in by themselves; check them, pick when to follow up, and tap Log inquiry.",
        "Open inquiries are sorted by what to do: Follow up now, Needs a price, Waiting on the buyer, and Gone quiet. Tap Follow up or Update on one to note what happened and pick the next day (Tomorrow, In 3 days, Next week). On that day it shows on Home.",
        "When you send the price, tap We sent the price. When a sample goes, tap Sample sent. Chase on WhatsApp opens a ready message to the buyer.",
        "When the buyer confirms, tap Buyer confirmed: make the order. The order opens with the buyer and the style filled in. If it doesn't happen, tap Lost and pick the reason; Gone quiet ones close in one tap.",
        "An email the PO pickup caught that is really an inquiry: open it in Buyer POs and tap It's an inquiry."],
    words: "inquiry enquiry new inquiry lead buyer asked quote quoted price sample sent lost follow up follow-up convert sales order prospect paste whatsapp gone quiet", pages: ["/inquiries", "/today"] },
  { id: "goods", who: "staff", roles: ORDERS_TEAM, q: "Where do I see goods that are with us, and print a delivery challan?",
    a: ["Goods with us shows every lot bought from a factory until it ships, with how long it has been with us. Goods should leave within 24 hours; after that the lot turns red here and on Home.",
        "Each lot shows its next step: the buyer invoice, the e-way bill, or the photos and LR. Tap the button to open the order's Dispatch tab.",
        "Tap Delivery challan on a lot (or in Dispatch) to print it. Give it a number once (DC-0001 and on); printing again shows the same challan. The buyer's delivery address is entered once and kept. Our address and GSTIN are set by the owner."],
    words: "goods with us warehouse stock held 24 hours delivery challan dc packing list print address gstin grn waiting dispatch ship", pages: ["/goods"] },
  { id: "catalogue", who: "staff", roles: ORDERS_TEAM, q: "How do I find an old style or see all styles with photos?",
    a: ["Open Style catalogue in the menu. It shows every style on open orders as photos; tap All orders to see past ones too.",
        "Search by style number, description, colour or fabric, or pick a buyer or factory. Tap a style to open its order and TNA."],
    words: "style catalogue gallery photos old style past style search fabric colour find design", pages: ["/styles"] },
  { id: "reports", who: "staff", roles: ORDERS_TEAM, q: "How do I see which factory is late or failing QC?",
    a: ["Open Reports in the menu and pick 30 days, 90 days or 1 year.",
        "The factory scorecard shows, for each factory: TNA steps done on time, average days late, steps overdue now, final QC passed, plans sent within 24 hours, and lots shipped on time. Green is 90% or more, amber from 80%, red below.",
        "Which steps run late shows the TNA steps that slip most across all styles. Download CSV gives the scorecard for Excel."],
    words: "reports report scorecard factory score late on time percent qc pass rate plans 24 hours shipped on time csv excel download", pages: ["/reports"] },
  { id: "move-target", who: "staff", q: "Can a target date be moved after the PO is released?",
    a: ["Only the owner can move a target after release, and must say why.", "The step keeps showing where it started, so slips stay visible."],
    words: "locked target change target after release move date locked", pages: ["/orders/"] },
  { id: "done-date", who: "staff", q: "How do I mark a step done?",
    a: ["Open the order, go to Styles and open the style.", "Enter the date in the step's Done box and save. Done dates open once the factory PO is released.",
        "The orders team and Quality can enter done dates."],
    words: "step done complete mark done done date cutting done stitching done update step", pages: ["/orders/", "/today"] },
  { id: "done-locked", who: "staff", q: "The Done box is grey or says After PO release. Why can't I enter dates?",
    a: ["Done dates open only once that factory's PO is released, so actual dates follow an agreed plan.",
        "Fill every target and the factory's dates, then send the PO for approval. Approval releases the PO and opens Done.",
        "If the PO was already with the factory before (for example the order replaced an older one), tell Dheeraj from here so he can carry the release over."],
    words: "done grey greyed disabled dark locked cannot enter done date not editable after po release done column", pages: ["/orders/"] },
  { id: "fabric-order", who: "staff", roles: ORDERS_TEAM, q: "This is a fabric order. How do I take off the garment steps?",
    a: ["A style whose description is Fabric is set as fabric by itself. For any other, open the order, go to Styles and tap Fabric (next to Garment) on the style's card.",
        "Fit sample, fabric in-house, PP sample, size set, cutting, stitching, inline and mid-line come off its TNA. Greige, printing / dyeing, strike off, finishing, packed, final QC and ex-factory stay.",
        "Start production fills fabric targets over about three weeks, with a 2-day buffer before the ship date. Do it before the factory PO is released; after that the steps are locked."],
    words: "fabric order fabric only cloth meter metre not garment production steps not required remove steps cutting stitching kapda", pages: ["/orders/"] },
  { id: "factory-updates", who: "staff", q: "A factory sent a step done with photos. How do I confirm it?",
    a: ["It shows on Home and on the order under Factory updates to confirm.", "Look at the photos. Tap Confirm to put the done date in.",
        "Not right? Tap Not yet and write why (for example: photo of cut panels needed). The factory sees your reason."],
    words: "factory update confirm photos approve reject not yet factory sent", pages: ["/orders/", "/today"] },
  { id: "style-photo", who: "staff", roles: ORDERS_TEAM, q: "How do I add a photo of a style?",
    a: ["Open the order and go to Styles.", "Tap the photo box on the style's card and pick or take a photo. It shows for the team and the buyer."],
    words: "style photo picture image garment photo", pages: ["/orders/"] },

  // ---------------------------------------------------------------- factories
  { id: "add-factory", who: "staff", roles: ORDERS_TEAM, q: "How do I add a factory?",
    a: ["Go to Factories and tap Add factory.", "Enter the name, contact person and phone, keep Active ticked, and save. It now shows when entering orders."],
    words: "new factory add vendor supplier manufacturer", link: { href: "/factories", label: "Open Factories" }, pages: ["/factories"] },
  { id: "factory-link", who: "staff", roles: ORDERS_TEAM, q: "How do I send a factory its WhatsApp link?",
    a: ["On Factories (or the factory's header on an order) tap Factory link.", "Pick हिंदी or English and tap WhatsApp. The factory opens the link; no password.",
        "Sent to the wrong person? Tap Make a new link. The old one stops working at once."],
    words: "factory link whatsapp login factory panel send link factory access hindi", pages: ["/factories", "/orders/"] },
  { id: "factory-board", who: "staff", roles: ORDERS_TEAM, q: "Where do I see what each factory is working on?",
    a: ["Factories shows each factory's POs, buyers, styles and progress, with what is released and what is waiting."],
    words: "factory board load work capacity factory wise", link: { href: "/factories", label: "Open Factories" }, pages: ["/factories"] },
  { id: "no-factory", who: "staff", roles: ORDERS_TEAM, q: "It says some styles have no factory. What do I do?",
    a: ["Open the order and go to Details.", "Pick the factory on each style and save. The TNA can be planned once a style has its factory."],
    words: "needs factory no factory choose factory assign factory", pages: ["/", "/today", "/orders/"] },

  // ---------------------------------------------------------------- buyers and logins
  { id: "add-buyer", who: "staff", q: "How do I add a new buyer?",
    a: ["The owner adds buyers: Buyers, then Add buyer.", "From an incoming PO by a new buyer, the owner can tap Add as a new buyer."],
    words: "new buyer add customer client party", link: { href: "/buyers", label: "Open Buyers" }, pages: ["/buyers", "/pos"] },
  { id: "partner-logins", who: "staff", q: "How do buyers and factories get their own login?",
    a: ["Factories use their WhatsApp link (Factory link on Factories).",
        "For a buyer, the owner goes to Team, Add a person, picks the role Buyer and the buyer, and enters their email.",
        "A buyer sees only its own orders: styles, steps, ship dates and final QC. No factories, no prices."],
    words: "buyer login buyer access buyer portal customer login factory login", pages: ["/team", "/buyers"] },
  { id: "add-person", who: "staff", roles: ["owner"], q: "How do I add someone to the team?",
    a: ["Go to Team and fill in Add a person: their work email and role.", "They sign in at this site with that email and get a link; no password needed.",
        "Change a role or switch someone off from their row on Team."],
    words: "add user add staff new member invite employee role", link: { href: "/team", label: "Open Team" }, pages: ["/team"] },
  { id: "activity", who: "staff", roles: ["owner"], q: "How do I see who changed something?",
    a: ["Activity log lists every change: who, when, and before and after. Nobody can edit or delete it.",
        "On an order, History shows the changes to that order."],
    words: "activity log history audit who changed changes record", link: { href: "/activity", label: "Open Activity log" }, pages: ["/activity", "/orders/"] },

  // ---------------------------------------------------------------- quality
  { id: "record-qc", who: "staff", roles: ["owner", "quality"], q: "How do I record a QC check?",
    a: ["Open the order and go to QC. Tap Record QC.", "Pick the style and type of check, the date, pieces checked, defects found, and Pass or Fail.",
        "Attach the signed QC report as proof, and photos if you have them (a check needs at least one file). If it failed, write what the factory must fix.", "Save. Each style has its own QC."],
    words: "qc quality check inspection record qc inline midline final qc report defects pass fail", pages: ["/orders/"] },
  { id: "qc-types", who: "staff", q: "Which QC type do I pick?",
    a: ["Greige to size set: samples and approvals.", "Inline and mid-line: during production.", "Final: before shipping. Re-check: after a failed final; it counts as the final."],
    words: "qc type kind inline midline final recheck re-check", pages: ["/orders/"] },
  { id: "qc-comment", who: "staff", q: "How do I comment on or cancel a QC check?",
    a: ["Anyone can tap Comment under a check.", "Quality or the owner can tap Cancel check and give a reason (for example: entered on the wrong order). It stays in History."],
    words: "comment qc cancel qc wrong qc delete qc", pages: ["/orders/"] },
  { id: "qc-redo", who: "staff", roles: ["owner", "quality"], q: "I entered a QC check or report wrong. How do I enter it again?",
    a: ["Only the file is wrong? Under QC, tap ✕ next to the wrong file on that check, then tap Add report and pick the right one. The check stays as it is.",
        "Result, date, pieces or style wrong? Tap Cancel check on that check and write why (for example: wrong report). Then tap Record QC and enter it again.",
        "A saved check is never edited, so the cancelled one stays in History with your reason.",
        "Hindi: sirf file galat hai to galat file ke aage ✕ dabao, phir Add report se sahi report daalo. Baaki kuch galat hai to Cancel check dabao, wajah likho, phir Record QC se dubara daalo."],
    words: "qc wrong report again redo re-enter mistake galat dubara phir se report dobara qc cancel change file", pages: ["/orders/"] },
  { id: "qc-block", who: "staff", q: "Why can't I mark shipped or dispatch the goods?",
    a: ["Every style's latest final QC must have passed. If one failed, the factory fixes it and Quality records a re-check.",
        "QC on the order shows which style is missing its passed final."],
    words: "cannot ship blocked dispatch blocked final qc not passed shipping stopped", pages: ["/orders/"] },

  // ---------------------------------------------------------------- dispatch
  { id: "dispatch", who: "staff", roles: ORDERS_TEAM, q: "How does dispatch work?",
    a: ["Open the order and go to Dispatch. Tap Record a purchase and enter the factory's bill. That starts 4 hours to invoice the buyer.",
        "Enter the Tally invoice once it is made. The e-way bill then fills in by itself from Tally.",
        "Before the goods leave, add photos of the packed goods, the transporter and the LR.", "After delivery, attach the buyer's GRN report by its due date."],
    words: "dispatch purchase invoice eway lr transporter grn goods send bill shipment", pages: ["/orders/", "/today"] },
  { id: "part-ship", who: "staff", roles: ORDERS_TEAM, q: "How do I ship an order in parts?",
    a: ["Record each part as its own purchase in Dispatch. After the first, tap Record the next part: the pieces still to buy are filled in for you.",
        "Each part has its own factory bill, invoice, e-way bill, LR and GRN. The order shows how many pieces have shipped and how many are left, and stays open until all are billed.",
        "If the rest won't go (the buyer took less, or the factory can't make it), tap Close short in Dispatch and say why. The owner sees it in the morning brief."],
    words: "part partial shipment split dispatch second part balance remaining pieces short close short less quantity", pages: ["/orders/", "/today"] },
  { id: "eway", who: "staff", roles: ORDERS_TEAM, q: "Where does the e-way bill come from?",
    a: ["It is made in Tally with the invoice. The app reads Tally every 15 minutes while Tally is open and fills it in.",
        "If it is needed sooner, tap Enter it by hand instead. The number has 12 digits."],
    words: "eway e-way bill ewaybill tally eway missing", pages: ["/orders/"] },
  { id: "grn", who: "staff", roles: ORDERS_TEAM, q: "What is the GRN step?",
    a: ["After the buyer receives the goods, get their GRN report (goods received note).",
        "On the order's Dispatch, enter the pieces received, any shortages and attach the report, before the GRN due date."],
    words: "grn goods received note buyer received shortage", pages: ["/orders/", "/buyers"] },

  // ---------------------------------------------------------------- money
  { id: "add-invoice", who: "staff", roles: MONEY, q: "How do I add an invoice?",
    a: ["Go to Payments and tap Add invoice.", "Enter the buyer, invoice number, date and amount including tax, and save.",
        "Invoices also come in from Tally: Tally shows what is in Tally but not yet in Payments."],
    words: "invoice bill add invoice raise invoice", link: { href: "/payments/invoices/new", label: "Add invoice" }, pages: ["/payments"] },
  { id: "record-cheque", who: "staff", roles: MONEY, q: "How do I record a cheque from a buyer?",
    a: ["Go to Payments and tap Record cheque.", "Enter the cheque number, bank, date and amount. Post-dated is fine.",
        "Pick the buyer and tick the invoices it pays, then save."],
    words: "cheque check chq pdc post dated payment received", link: { href: "/payments/cheques/new", label: "Record cheque" }, pages: ["/payments"] },
  { id: "cheque-status", who: "staff", roles: MONEY, q: "How do I mark cheques deposited, cleared or bounced?",
    a: ["On Payments, tick the cheques and pick Deposited, Cleared or Bounced to mark several at once.", "Or open one cheque and change it there."],
    words: "deposit cleared bounce status cheque check bank clear", pages: ["/payments"] },
  { id: "bills-to-pay", who: "staff", roles: MONEY, q: "Which factory bills do we have to pay, and when?",
    a: ["Open Bills to pay (under Finance in the menu, or Plan payments on Home). Every factory and supplier bill booked in Tally with money left on it is there, grouped by when it falls due: overdue first.",
        "A bill is paid once Tally has a payment or debit note against it. Payments made on account are set against the oldest bills first, so the total matches the balance in Tally.",
        "Tick the bills you will pay and tap Send on WhatsApp to share the payment list. Nothing is paid or changed in Tally from the app."],
    words: "factory bill payable payment due creditor supplier pay vendor purchase bill outstanding kitna dena hai payment karna",
    link: { href: "/payables", label: "Bills to pay" }, pages: ["/payables", "/today", "/payments"] },
  { id: "payment-terms", who: "staff", roles: MONEY, q: "How do I set a factory's payment days or MSME (Udyam) details?",
    a: ["On Bills to pay, open By supplier and tap Terms under the supplier.", "Payment days are 60 unless you set others.",
        "If the supplier is a micro or small enterprise with a Udyam number, choose it: by law it must be paid within 45 days, so its bills fall due on day 45 even on 60-day terms.",
        "A bill can also be held, with a reason (for example a short delivery). Held bills drop out of the reminders until released."],
    words: "credit days payment terms msme udyam micro small 45 days 43b factory terms supplier",
    link: { href: "/payables?view=suppliers", label: "Supplier terms" }, pages: ["/payables"] },
  { id: "bounced", who: "staff", roles: MONEY, q: "A cheque bounced. What now?",
    a: ["Mark it Bounced. The cheque page then shows the deadlines: the notice to send, the date to pay by, and the date to file by.",
        "Dates are counted to be safe. Your lawyer confirms the exact dates."],
    words: "bounced cheque check dishonour return legal notice 138", pages: ["/payments"] },
  { id: "paid-other", who: "staff", roles: MONEY, q: "What does 'Paid another way' mean?",
    a: ["The invoice was paid by NEFT or RTGS, so the cheque was never banked. Give the cheque back to the buyer."],
    words: "paid another way neft rtgs return cheque", pages: ["/payments"] },
  { id: "tally", who: "staff", roles: MONEY, q: "How does Tally connect to the app?",
    a: ["The office Tally computer sends Tally's data every 15 minutes while Tally is open.",
        "The app only reads Tally. Nothing in the app ever changes Tally.", "Tally shows what differs between Tally and Payments, so you can correct the wrong side."],
    words: "tally sync connect tally not updating tally reading", link: { href: "/tally", label: "Open Tally" }, pages: ["/tally", "/payments"] },
  { id: "credit-days", who: "staff", roles: MONEY, q: "How is an invoice's due date worked out?",
    a: ["From the buyer's credit days, counted from the invoice date. An invoice with its own due date keeps it.",
        "Set credit days per buyer on Payments."],
    words: "credit days due date overdue ageing payment terms", pages: ["/payments"] },

  // ---------------------------------------------------------------- tools
  { id: "markers", who: "staff", roles: ORDERS_TEAM, q: "What is Markers for?",
    a: ["It works out fabric consumption and the most efficient cutting marker from photos of the garment.", "It is paused for now: it needs credit on the AI account, which has none. It comes back on the menu once credit is added."],
    words: "marker fabric consumption cad cutting marker average", link: { href: "/markers", label: "Open Markers" }, pages: ["/markers"] },
  { id: "notes", who: "staff", q: "How do I report a problem or suggest an idea?",
    a: ["Right here in Help: tap Something's wrong, Wrong data or I have an idea, or just type it.",
        "It goes to Dheeraj with the screen you were on. Attach screenshots, a short screen recording, or the PDF or Excel file that shows the problem.", "The answer shows under My notes."],
    words: "report bug problem idea suggestion feedback complaint improvement attach attachment file video recording pdf excel screenshot" },

  // ---------------------------------------------------------------- factory panel
  { id: "f-tna", who: "factory", q: "How do I send my TNA dates?",
    a: ["Open the order. Under each step you see Sourcingo's target.", "Enter your finish date for every step, on or before the target.",
        "Tap Send my TNA within 24 hours of being asked."],
    hi: { q: "अपनी TNA तारीखें कैसे भेजें?",
          a: ["ऑर्डर खोलें। हर स्टेप के ऊपर Sourcingo का टारगेट दिखता है।", "हर स्टेप के लिए अपनी तारीख डालें, टारगेट के दिन या उससे पहले।", "माँगे जाने के 24 घंटे के अंदर \"मेरी TNA भेजें\" दबाएँ।"] },
    words: "tna dates plan send date bharna tarikh kaise bhejna" },
  { id: "f-done", who: "factory", q: "How do I mark a step done with photos?",
    a: ["Open the order and tap Mark step done on the style.", "Pick the step, the date it was done, and add photos (Camera or Gallery).", "Tap Send to Sourcingo. It shows as done once Sourcingo confirms."],
    hi: { q: "स्टेप पूरा होने पर फोटो के साथ कैसे बताएँ?",
          a: ["ऑर्डर खोलें और स्टाइल पर \"स्टेप पूरा हुआ\" दबाएँ।", "स्टेप चुनें, पूरा होने की तारीख चुनें, और फोटो डालें (कैमरा या गैलरी)।", "\"Sourcingo को भेजें\" दबाएँ। Sourcingo के confirm करने पर पूरा दिखेगा।"] },
    words: "done photo step complete update progress kaam pura photo bhejna cutting stitching" },
  { id: "f-sample", who: "factory", q: "How do I send a sample for approval?",
    a: ["Open the order. Under Samples, tap Send sample next to the step (fit, strike off, PP or size set).", "Add photos of the sample and a note, then tap Send to Sourcingo.", "Sourcingo checks it and sends it to the buyer. If changes are asked, you see them here and tap Send round 2."],
    hi: { q: "सैंपल अप्रूवल के लिए कैसे भेजें?",
          a: ["ऑर्डर खोलें। Samples में स्टेप (fit, strike off, PP या size set) के आगे \"सैंपल भेजें\" दबाएँ।", "सैंपल की फोटो और नोट डालें, फिर \"Sourcingo को भेजें\" दबाएँ।", "Sourcingo जाँच कर buyer को भेजेगा। बदलाव माँगे जाएँ तो यहीं दिखेंगे, फिर अगला राउंड भेजें।"] },
    words: "sample fit pp size set strike off approval bhejna sample bhejna round changes buyer" },
  { id: "f-photo", who: "factory", q: "My photo doesn't upload. What do I do?",
    a: ["Some phones save HEIC photos, which the app can't open. In the camera settings, choose JPEG or Most compatible.",
        "Or share the photo to yourself on WhatsApp first, then pick it from the Gallery.", "Check the internet and try again."],
    hi: { q: "फोटो अपलोड नहीं हो रही, क्या करें?",
          a: ["कुछ फोन HEIC फोटो बनाते हैं, जो ऐप नहीं खोल पाता। कैमरा सेटिंग में JPEG या Most compatible चुनें।",
              "या फोटो पहले WhatsApp पर खुद को भेजें, फिर गैलरी से चुनें।", "इंटरनेट देखकर फिर से कोशिश करें।"] },
    words: "photo upload not working error heic camera image foto nahi ja rahi" },
  { id: "f-late", who: "factory", q: "I can't finish a step by the target date. What do I do?",
    a: ["Give your real date. A date later than the target holds up the PO, so call your Sourcingo merchandiser to agree a plan."],
    hi: { q: "टारगेट तक स्टेप पूरा नहीं हो सकता, क्या करें?",
          a: ["अपनी सही तारीख डालें। टारगेट से बाद की तारीख पर PO रुक जाता है, इसलिए अपने Sourcingo मर्चेंडाइज़र से बात करके प्लान तय करें।"] },
    words: "late target delay cannot finish time extend der late hoga" },
  { id: "f-fixed", who: "factory", q: "Can I change my dates after the PO is released?",
    a: ["No. Your dates are fixed after release. If something changes, tell Sourcingo; they can move it with a reason."],
    hi: { q: "PO रिलीज़ होने के बाद तारीख बदल सकते हैं?",
          a: ["नहीं। रिलीज़ के बाद आपकी तारीखें पक्की हो जाती हैं। कुछ बदले तो Sourcingo को बताएँ; वे कारण के साथ बदल सकते हैं।"] },
    words: "change date edit date released fixed locked tarikh badalna" },
  { id: "f-qc", who: "factory", q: "Why can't I mark Final QC or ex-factory done?",
    a: ["Final QC is Sourcingo's quality check and ex-factory is the dispatch, so Sourcingo enters those two."],
    hi: { q: "फाइनल QC या फैक्ट्री से रवाना क्यों नहीं डाल सकते?",
          a: ["फाइनल QC Sourcingo की क्वालिटी चेक है और रवाना होना डिस्पैच है, इसलिए ये दोनों Sourcingo डालता है।"] },
    words: "final qc ex factory dispatch cannot mark" },
  { id: "f-not-shown", who: "factory", q: "I sent a step done but it doesn't show as done.",
    a: ["It shows as done once Sourcingo checks your photos and confirms.", "If they need more, they send it back with a reason, which you see on the step."],
    hi: { q: "स्टेप भेजा पर पूरा नहीं दिख रहा?",
          a: ["Sourcingo आपकी फोटो देखकर confirm करेगा, तब पूरा दिखेगा।", "अगर और चाहिए तो वे कारण के साथ वापस भेजेंगे, जो आपको स्टेप पर दिखेगा।"] },
    words: "not showing pending waiting confirm nahi dikh raha" },
  { id: "f-lang", who: "factory", q: "How do I change the language?",
    a: ["Tap हिंदी or English at the top of the screen. The phone remembers it."],
    hi: { q: "भाषा कैसे बदलें?", a: ["ऊपर हिंदी या English दबाएँ। फोन इसे याद रखेगा।"] },
    words: "language hindi english bhasha" },
  { id: "f-link", who: "factory", q: "My link doesn't open.",
    a: ["Ask Sourcingo on WhatsApp for a new link. An old link stops working when a new one is made."],
    hi: { q: "मेरा लिंक नहीं खुल रहा।", a: ["Sourcingo से WhatsApp पर नया लिंक माँगें। नया लिंक बनने पर पुराना बंद हो जाता है।"] },
    words: "link not working open login cannot open link nahi khul raha" },
  { id: "f-notes", who: "factory", q: "How do I tell Sourcingo about a problem?",
    a: ["Right here: tap Something's wrong or just type it, and send. Attach a photo, a short video or a PDF if it helps. Sourcingo's answer shows under My notes."],
    hi: { q: "Sourcingo को कोई दिक्कत कैसे बताएँ?", a: ["यहीं पर: \"कुछ गड़बड़ है\" दबाएँ या लिखकर भेजें। चाहें तो फोटो, छोटा वीडियो या PDF जोड़ें। जवाब \"मेरे संदेश\" में दिखेगा।"] },
    words: "problem complaint issue dikkat shikayat help" },

  // ---------------------------------------------------------------- buyer page
  { id: "b-what", who: "buyer", q: "What can I see here?",
    a: ["Every open order of yours: where each style is, its ship date and its final quality check. It is live from Sourcingo."],
    words: "what see orders status page" },
  { id: "b-sample", who: "buyer", q: "How do I approve a sample?",
    a: ["Samples waiting for you are at the top, with photos, courier and AWB.", "Tap Approve, or Ask for changes and say what to change (you can add photos).", "Earlier answers are under Samples answered."],
    words: "sample approve approval fit pp size set strike off changes comments courier" },
  { id: "b-ship", who: "buyer", q: "Which ship date is shown?",
    a: ["The latest ship date Sourcingo expects. If it moved from your PO's date, both are shown."],
    words: "ship date delivery date late when" },
  { id: "b-qc", who: "buyer", q: "Where is the final quality check?",
    a: ["Each style shows its final QC result with photos once Sourcingo's Quality has checked it."],
    words: "final qc quality inspection report photos" },
  { id: "b-notes", who: "buyer", q: "How do I ask Sourcingo something or report a problem?",
    a: ["Type it here and send it to Sourcingo. The answer shows under My notes. For anything urgent, message your Sourcingo merchandiser."],
    words: "contact question problem complaint merchandiser" },
];

// ---------------------------------------------------------------- search
const STOP = new Set(("a an the i me my we our you your to of in on at for and or is are am be it this that do does did can could " +
  "how what why where when which who will would should please pls plz there here with from by get got want need " +
  "kaise kese kya kyu kyun kab kahan hai hain ho karna karu karun kare karein karte ka ki ke ko se me mein par aur ya bhi hi " +
  "कैसे क्या क्यों कब कहाँ है हैं हो करें करना का की के को से में पर और या भी").split(" "));

// Words that mean the same thing here.
const SAME: Record<string, string> = {
  chq: "cheque", cheques: "cheque", pdc: "cheque",
  pic: "photo", pics: "photo", picture: "photo", image: "photo", images: "photo", foto: "photo", tasveer: "photo", फोटो: "photo", photos: "photo",
  login: "sign", signin: "sign", logon: "sign", password: "sign",
  ship: "shipped", shipping: "shipped", shipment: "dispatch", dispatched: "dispatch", bhejna: "send", bheje: "send", bhejo: "send",
  delete: "cancel", remove: "cancel", hatana: "cancel",
  edit: "change", update: "change", modify: "change", badalna: "change", badle: "change", correct: "change",
  tarikh: "date", tareekh: "date", dates: "date", तारीख: "date",
  quality: "qc", inspection: "qc", qa: "qc",
  vendor: "factory", supplier: "factory", factories: "factory", फैक्ट्री: "factory",
  customer: "buyer", client: "buyer", party: "buyer", buyers: "buyer",
  ewaybill: "eway", "e-way": "eway",
  complete: "done", completed: "done", finish: "done", finished: "done", pura: "done", poora: "done", पूरा: "done",
  styles: "style", orders: "order", steps: "step", targets: "target", invoices: "invoice",
  riport: "report", riporat: "report", reports: "report", रिपोर्ट: "report",
  galat: "wrong", galti: "wrong", mistake: "wrong", गलत: "wrong", dubara: "again", dobara: "again", fir: "again", phir: "again", दोबारा: "again",
  daale: "new", dale: "new", daalna: "new", dalna: "new", daalo: "new",
  naya: "new", nayi: "new", add: "new", create: "new", banana: "new", enter: "new",
};

const norm = (t: string) => {
  let w = t.toLowerCase();
  if (SAME[w]) return SAME[w];
  if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return SAME[w] ?? w;
};
export const words = (s: string) =>
  s.toLowerCase().replace(/e-way/g, "eway").split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(norm);

export type Viewer = { who: Audience; role: Role | null };
const canSee = (t: Topic, v: Viewer) => t.who === v.who && (!t.roles || (!!v.role && t.roles.includes(v.role)));
const onPage = (t: Topic, path: string) => !!t.pages?.some((p) => (p === "/" ? path === "/" : path.startsWith(p)));

const index = new Map<string, { q: Set<string>; rest: Set<string> }>();
function topicWords(t: Topic) {
  let w = index.get(t.id);
  if (!w) {
    w = { q: new Set(words(`${t.q} ${t.hi?.q ?? ""}`)), rest: new Set(words(`${t.words ?? ""} ${t.a.join(" ")} ${t.hi?.a.join(" ") ?? ""}`)) };
    index.set(t.id, w);
  }
  return w;
}

// The best answers for a question, best first, with how well each matched. A topic must share a real word with the
// question. A match on a topic the person's role doesn't use is answered with who can do it instead.
export function searchScored(question: string, v: Viewer, path: string): { t: Topic; score: number }[] {
  const qw = [...new Set(words(question))];
  if (!qw.length) return [];
  const scored = TOPICS.filter((t) => t.who === v.who).map((t) => {
    const w = topicWords(t);
    let score = 0;
    let hits = 0;
    let inTitle = 0;
    for (const x of qw) {
      const inQ = w.q.has(x) || (x.length >= 4 && [...w.q].some((y) => y.length >= 4 && (y.startsWith(x) || x.startsWith(y))));
      const inRest = w.rest.has(x) || (x.length >= 5 && [...w.rest].some((y) => y.length >= 5 && (y.startsWith(x) || x.startsWith(y))));
      if (inQ) { score += 3; inTitle++; }
      else if (inRest) score += 1.5;
      if (inQ || inRest) hits++;
    }
    if (hits && onPage(t, path)) score += 1;
    // Share of the question that matched: one stray word in a long question is not an answer.
    // Then, between equal matches, the topic whose title is mostly the question's words.
    return { t, score: hits ? score * (0.5 + hits / qw.length) + inTitle / Math.max(1, w.q.size) : 0 };
  }).filter((s) => s.score >= 3).sort((a, b) => b.score - a.score);
  const out: { t: Topic; score: number }[] = [];
  for (const s of scored) {
    const t = canSee(s.t, v) ? s.t : TOPICS.find((x) => x.id === "access")!;
    if (!out.some((o) => o.t.id === t.id)) out.push({ t, score: s.score });
    if (out.length === 3) break;
  }
  return out;
}
export const search = (question: string, v: Viewer, path: string): Topic[] => searchScored(question, v, path).map((s) => s.t);

// Questions to offer on the screen the person is on.
export function suggestions(v: Viewer, path: string, n = 4): Topic[] {
  const mine = TOPICS.filter((t) => canSee(t, v));
  const here = mine.filter((t) => onPage(t, path));
  return [...here, ...mine.filter((t) => !here.includes(t))].slice(0, n);
}

export const topicById = (id: string) => TOPICS.find((t) => t.id === id);

// ---------------------------------------------------------------- what kind of message it is
export type NoteKind = "problem" | "wrong_data" | "idea" | "question";
const PROBLEM = /\b(not working|doesn'?t work|does not work|isn'?t working|error|bug|broken|crash|stuck|fail(ed|s)?|can'?t|cannot|unable|won'?t|not (opening|loading|saving|showing|coming)|slow|hang|blank|nahi (ho|chal|khul|aa|dikh)|kaam nahi|problem|issue|dikkat)\b|नहीं (हो|चल|खुल|आ|दिख)|दिक्कत|गड़बड़/i;
const WRONG = /\b(wrong|incorrect|mistake|galat|galti|mismatch|should be|instead of|not matching|doesn'?t match|duplicate|twice)\b|गलत/i;
const IDEA = /\b(idea|suggest(ion)?|feature|improve|better|would be (nice|good|great)|it would help|we need|need a|add an?|can we|could we|should (have|show|be able)|wish|chahiye|hona chahiye|kar sakte)\b|चाहिए/i;

// A guess at what a typed message is, so Help can offer to send it to the owner.
export function guessKind(text: string): NoteKind | null {
  if (WRONG.test(text)) return "wrong_data";
  if (PROBLEM.test(text)) return "problem";
  if (IDEA.test(text)) return "idea";
  return null;
}

// What each screen is called, for notes and for Help's greeting.
export function pageTitle(path: string): string {
  const names: [string, string][] = [
    ["/today", "Home"], ["/orders/new", "New order"], ["/orders/", "Order"], ["/pos/", "Incoming PO"], ["/pos", "Buyer POs"], ["/brief", "Brief"],
    ["/buyers", "Buyers"], ["/factories", "Factories"], ["/markers", "Markers"], ["/payments/cheques", "Cheque"], ["/payments/invoices", "Invoice"],
    ["/payments", "Payments"], ["/tally", "Tally"], ["/team", "Team"], ["/activity", "Activity log"], ["/feedback", "Team notes"],
    ["/factory", "Factory panel"], ["/buyer", "Buyer page"],
  ];
  if (path === "/") return "Orders";
  return names.find(([p]) => path.startsWith(p))?.[1] ?? "App";
}
