# ChiragPay Autopay Recovery Demo
Voice Ai agent for recovering  autopay failed transaction.
A  Node.js and Twilio demonstration for failed-autopay follow-up. Transaction records, call attempts, answers, and transcripts are stored in `data.json`.

The first server start creates ten fictional records using reserved example phone numbers. Customer phone numbers are stored for the record only; outbound calls always go to the single `DEMO_PHONE` configured by the operator.

## Application Preview

[View Application](application_preview.pdf)

## Run the Local Demo

Requires **Node.js 20.6 or newer**.

```sh
npm install
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Select a transaction, choose **Simulate agent**, and answer the consent, explanation, and retry prompts.

This local simulation exercises the dialogue and persists its transcript without placing a call.

Use **Add transaction** to append a failed transaction to the JSON file.

> **Important:** Mark a transaction paid only after confirming payment in the payment system you use. Saying **“pay now”** records intent; this demo does not create payment links, charge a payment method, or verify settlement.

Retry dates are recorded for an operator to follow up; there is no unattended call scheduler.

A paid transaction cannot be called again.

## Optional Twilio Phone Call

Only enable this against a number you control or have explicit permission to call.

**Never use the fictional customer numbers for outbound calls.**

### 1. Configure Environment Variables

Copy `env.example` to `.env` and fill in your Twilio Account SID, Auth Token, Twilio caller ID, and the one authorized destination as `DEMO_PHONE`.

```env
TWILIO_TOKEN=
TWILIO_FROM=
PUBLIC_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# Required before exposing the dashboard through a public tunnel.
DASHBOARD_USERNAME=
DASHBOARD_PASSWORD=

# Calls are disabled by default. Enable only when DEMO_PHONE is yours or authorized.
ALLOW_OUTBOUND_CALLS=true

DEMO_PHONE=
```

### 2. Configure the Public URL

Set `PUBLIC_URL` to the HTTPS forwarding URL for your local server.

For example, run `ngrok` in a separate terminal:

```sh
ngrok http 3000
```

Then use its HTTPS URL as the value of `PUBLIC_URL`.

### 3. Configure Dashboard Authentication

Set a unique `DASHBOARD_USERNAME` and strong `DASHBOARD_PASSWORD`.

The dashboard and API use HTTP Basic authentication when these are set.

Twilio `/voice` and `/status` callbacks are checked against Twilio request signatures.

### 4. Enable Outbound Calls

Keep:

```env
ALLOW_OUTBOUND_CALLS=false
```

until the Twilio credentials, public callback URL, and destination are verified.

Then set it to:

```env
ALLOW_OUTBOUND_CALLS=true
```

Restart the server and use **Call demo phone**.

The UI requires the exact destination and an explicit authorization checkbox; the server independently checks both.

## LLM-Powered Phone Conversation

The phone agent uses OpenAI's **GPT-4o mini** model by default. Set `OPENAI_API_KEY` in `.env` to enable it. The model can be changed with `OPENAI_MODEL` to another model available to your OpenAI account; if unset, it defaults to `gpt-4o-mini`.

Twilio converts the caller's speech to text and speaks the agent's response. After the caller explicitly consents, the app sends the recognized utterance, recent conversation transcript, and limited transaction facts (amount, failure reason, and status) to the OpenAI Chat Completions API. The model returns a short spoken reply and a structured intent. It can answer questions about the supplied facts, continue the conversation, or identify a clear request to record pay-now intent, schedule a follow-up, or stop the call.

The server applies payment-intent and retry-date changes; the model does not process payments, confirm settlement, or mark a transaction paid. Do not send payment credentials or other secrets in conversation. If `OPENAI_API_KEY` is missing, the phone call uses the original scripted prompts. If an OpenAI request fails during a call, the app falls back to a scripted pay-now or retry prompt. The local **Simulate agent** workflow remains scripted and does not call OpenAI.

## Call and Data Safety

Twilio speech recognition and synthesis handle the live phone dialogue.

The app does not record call audio.

The customer must consent to continue before transaction details are discussed.

Do not collect card numbers, bank credentials, or other payment secrets in a call.

Twilio trial accounts may only call verified destinations and may require an introductory trial message.

## Public Tunnel Safety

The public tunnel makes the service reachable from the internet while active.

Use fictional data for this demo, protect the dashboard with credentials, and stop the tunnel when finished.

Outbound calling is disabled by default.
