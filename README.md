# Tandem Autopay Recovery Demo

A small Node.js and Twilio demonstration for failed-autopay follow-up. Transaction records, call attempts, answers, and transcripts are stored in `data.json`. The first server start creates ten fictional records using reserved example phone numbers. Customer phone numbers are stored for the record only; outbound calls always go to the single `DEMO_PHONE` configured by the operator.

## Run the local demo

Requires Node.js 20.6 or newer.

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>. Select a transaction, choose **Simulate agent**, and answer the consent, explanation, and retry prompts. This local simulation exercises the dialogue and persists its transcript without placing a call. Use **Add transaction** to append a failed transaction to the JSON file.

Mark a transaction paid only after confirming payment in the payment system you use. Saying “pay now” records intent; this demo does not create payment links, charge a payment method, or verify settlement. Retry dates are recorded for an operator to follow up; there is no unattended call scheduler. A paid transaction cannot be called again.

## Optional Twilio phone call

Only enable this against a number you control or have explicit permission to call. Never use the fictional customer numbers for outbound calls.

1. Copy `env.example` to `.env` and fill in your Twilio Account SID, Auth Token, Twilio caller ID, and the one authorized destination as `DEMO_PHONE`.
2. Set `PUBLIC_URL` to the HTTPS forwarding URL for your local server. For example, run `ngrok http 3000` in a separate terminal and use its HTTPS URL.
3. Set a unique `DASHBOARD_USERNAME` and strong `DASHBOARD_PASSWORD`. The dashboard and API use HTTP Basic authentication when these are set; Twilio `/voice` and `/status` callbacks are checked against Twilio request signatures.
4. Keep `ALLOW_OUTBOUND_CALLS=false` until the Twilio credentials, public callback URL, and destination are verified. Then set it to `true`, restart the server, and use **Call demo phone**. The UI requires the exact destination and an explicit authorization checkbox; the server independently checks both.

Twilio speech recognition and synthesis handle the live phone dialogue. The app does not record call audio. The customer must consent to continue before transaction details are discussed. Do not collect card numbers, bank credentials, or other payment secrets in a call. Twilio trial accounts may only call verified destinations and may require an introductory trial message.

The public tunnel makes the service reachable from the internet while active. Use fictional data for this demo, protect the dashboard with credentials, and stop the tunnel when finished. Outbound calling is disabled by default.