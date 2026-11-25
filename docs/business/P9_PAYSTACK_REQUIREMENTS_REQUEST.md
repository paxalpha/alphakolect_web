# To Paystack: what is required to give each of our businesses a dedicated account number

**To:** Paystack Support (Nigeria)
**From:** AlphaKolect
**Prepared:** 25 November 2026, for the owner to send. **Not sent.** Answers are needed in writing; they decide whether wallet creation can be
switched on (P9 plan §16.4 condition 3, owner Q4).
**Why:** In your test mode, a customer with a name and no phone number was accepted for a dedicated virtual account. We do not know
whether the same holds for our live account, and we will not guess: we hold no customer phone number or identity number today.

---

Hello Paystack Support,

AlphaKolect is a platform for savings groups and their businesses in Nigeria. Each business that joins us receives one dedicated virtual
account number to receive transfers; the platform keeps the record of what belongs to each business. We use the Dedicated Virtual Account
API (create a customer, then create the account). We need your written answers to the questions below before we create any live account.

## 1. Our business category

1. Which business category does Paystack assign to AlphaKolect for dedicated virtual accounts (for example "Financial services" or
   "General services")? Where do we see it on the dashboard?
2. Is our use (one dedicated account per business that uses our platform, with the businesses' money recorded in our books) permitted
   for that category? Is there anything in it that needs your prior approval?

## 2. What each account requires

3. For a live customer, which of these are **mandatory**: first name, last name, phone number, email, BVN, bank account number and bank
   code? Are any required only for some categories?
4. Does the identity validation (`POST /customer/{code}/identification`) have to succeed **before** a dedicated account can be created for
   our category? What happens to an account request made before it does?
5. The customer of each of our accounts is a **business**, not a person. Whose BVN and bank account does Paystack expect: the owner's, a
   director's, or the business's? Is a business name accepted as the customer's first name?
6. The account name a payer sees is built from our product name and the customer's name. Can we set the product name, and is there a limit
   on length or characters? What would the name be for a customer whose first name is a business name and whose last name is "Business"?
7. Do the customer's email and phone number receive any message from Paystack (a notification, a receipt) when a transfer arrives?

## 3. Test mode and live mode

8. In what ways do live requirements differ from test mode? In test mode we made a customer and an account without a phone number.
9. Is there anything else that must be completed on our Paystack business account (go-live documents, a dedicated-account feature
   request, a bank partner choice) before we can create live accounts? Which bank provider should we choose, and does it affect the account
   name, the fees or the "inbound transfer approval" feature?

## 4. Money and fees (answers to the custody questions are asked separately)

10. What fee does a transfer received on a dedicated account carry, who bears it, and is it taken when the money arrives or when it settles?
11. Does `GET /balance` include a received transfer at once, or after settlement? What is the delay?

Please reply in writing to the address that sent this message, so we can keep your answers on file with the project.

Thank you,
AlphaKolect

---

*For the owner, before sending: nothing here contains a key, a customer's details or our database. After Paystack answers, bring the reply to the
project lead: if it asks for a phone number or a BVN, AlphaKolect needs a privacy form (what is collected, why, how long it is kept, who sees
it) before anything is built.*
