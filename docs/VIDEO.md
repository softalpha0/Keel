# Demo video: storyboard and script

Target **4:15**, hard limit 5:00. 1920×1080, 30 fps. Record the screen at 1440×900 in the browser (dark mode reads best on video), then scale up.

Motion style: slow push-ins (105–110%) on the area being talked about, a soft spotlight (dim everything else to 40%), and short captions in Inter in the bottom-left. No transitions fancier than a 6-frame crossfade. The UI already animates the chart and reveals; let it.

Voiceover pace: about 150 words a minute. The script below is ~600 words.

---

## 0:00–0:20 · Cold open: the problem

**Screen:** Black. The chart line draws from left to right and dips toward a red dashed line labelled "Reserve floor · $30K". It stops just above the line.

**Caption:** `$100K fund · 3 merchants · 1 rule`

**VO:**
> A platform is lending to three of its merchants out of a hundred-thousand-dollar fund. One rule: cash never drops below thirty thousand. Every week they repay a share of their sales, and ask for more. Keel is the agent that runs that book on Airwallex.

## 0:20–0:45 · Landing hero

**Screen:** Landing page, top. Push in on the headline, then pan to the "Verified on the Airwallex sandbox" card.

**VO:**
> Keel collects repayments, reads each borrower's health, and sizes every advance against the reserve. Then it shows its working. Everything you'll see ran on the real engine, and the same ten weeks ran on the Airwallex sandbox. Those numbers are real transfers and charges.

## 0:45–1:20 · How it decides

**Screen:** Scroll to "The model reads. The code decides. The API moves the money." Spotlight each of the three cards in turn.

**VO:**
> The design splits judgement from authority. Signals turn revenue into a health tier. A policy engine builds every way to answer a request (full, partial, delay, reallocate, decline) and strikes anything that would breach the floor before a model ever sees it. The model can choose among what's left and write the memo. Only one component can touch the bank, and it never moves the same money twice.

## 1:20–2:30 · The console: the hard case

**Screen:** Open `/console`. Auto-approve **off**. Press **Run**. Let weeks 1–4 play (fast; speed up 2× in the edit). The approval dialog appears in week 5. Hold on it.

**Caption:** `Week 5 · Nimbus asks for $26,000`

**VO:**
> Weeks three and four, two advances go out. Week five, Nimbus Apparel asks for twenty-six thousand. Paying in full would leave twenty-six thousand two hundred, under the floor. So Keel looks for a way to say yes. Kopi Roasters has an unpaid promise, and Kopi's sales are softening. Keel proposes moving three thousand seven hundred of Kopi's promise to Nimbus, which lands cash exactly on the floor. Moving someone else's money always needs a person.

**Screen:** Click **Approve and execute**. Cut to the decision panel: option bars, the struck "Fund in full" row, the memo.

**VO:**
> Every option it considered is on the record, including the one it ruled out.

## 2:30–3:15 · Late money and old promises

**Screen:** Run continues into week 6. Click marker for "Ledgerly · Paid late", then "Kopi · Promise re-checked". Then the landing's "Late money" section as a cutaway.

**Caption:** `Week 6 · late money ≠ bad credit`

**VO:**
> Week six, two things happen. Ledgerly's customers pay sixty percent of their invoices late. Its sales are fine, so Keel takes its share of what arrived, books a five-hundred-twenty-dollar receivable, and keeps Ledgerly healthy. The next week the money lands and the receivable clears.
> Same week, Kopi's remaining top-up comes due. It was promised when Kopi was healthy. Kopi's now on watch and at capacity, so Keel re-runs the decision before paying and withdraws it.

Also visible: marker for the lost bank response.

> And when the bank loses a response, Keel retries with the same key and gets the original charge back. Moved once, not twice.

## 3:15–3:40 · Stress

**Screen:** Week 7 marker turns red. Borrowers panel: Nimbus → Stressed. Week 8 decline.

**VO:**
> Week seven, Nimbus's sales fall sixty-four percent. Keel marks it stressed, freezes new credit, and keeps collecting twelve percent of whatever it still sells. Repayments bend instead of breaking. When Nimbus asks again in week eight, the answer is no.

## 3:40–4:00 · What if

**Screen:** Drag "Nimbus revenue shock" to −85% and "Reserve floor" to $50K. The chart re-runs live.

**VO:**
> Change the world and the agent re-plans: a harsher shock, a higher floor. It holds every time. The tests check that across two thousand random portfolios.

## 4:00–4:15 · Proof on Airwallex

**Screen:** `/run`. Scroll the movements table: Airwallex ids, request_ids, "Settled", the catch-up row, receivables "Cleared W7", the BALANCE_REPORT line. End on the three green pills.

**Caption:** `connected_account_transfers · charges · BALANCE_REPORT`

**VO:**
> And here is the same run on the Airwallex sandbox. Connected accounts for each borrower, transfers out, charges back, a balance report at the end. The floor held every week, and the ledger matched the bank every week.

## 4:15–4:25 · End card

**Screen:** Dark card: Keel mark, "Lend against revenue. *Never* breach the floor.", the live site URL and the GitHub URL.

**VO:**
> Keel. The model reads, the code decides, the API moves the money.

---

## Shot list checklist

- [ ] Landing hero with the verified card (after committing the live `latest.json`)
- [ ] "How it decides" section
- [ ] Console run with the approval dialog at week 5 (auto-approve off)
- [ ] Decision panel with struck "full" option
- [ ] Markers: paid late, promise re-checked, lost response, stressed
- [ ] What-if sliders re-running
- [ ] `/run` movements table, receivables, balance report
- [ ] Optional: terminal running `npm run demo:sandbox` sped up 8×, for 3 seconds behind the "Proof" section
- [ ] End card
