const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const twilio = require("twilio");

if (fs.existsSync(".env")) process.loadEnvFile?.(".env");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB = path.join(__dirname, "data.json");
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const DEMO_PHONE = process.env.DEMO_PHONE || "";
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || "";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const twilioConfigured = Boolean(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);
const client = twilioConfigured ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const VoiceResponse = twilio.twiml.VoiceResponse;

const seedRecords = [
  ["TXN-1001", "PRD-201", "CUS-301", "Aarav Mehta", "+15555550101", 1499, "insufficient_funds"],
  ["TXN-1002", "PRD-202", "CUS-302", "Maya Kapoor", "+15555550102", 799, "card_expired"],
  ["TXN-1003", "PRD-203", "CUS-303", "Rohan Shah", "+15555550103", 2499, "bank_unavailable"],
  ["TXN-1004", "PRD-204", "CUS-304", "Anika Rao", "+15555550104", 599, "payment_method_declined"],
  ["TXN-1005", "PRD-205", "CUS-305", "Dev Patel", "+15555550105", 1299, "insufficient_funds"],
  ["TXN-1006", "PRD-206", "CUS-306", "Sara Iyer", "+15555550106", 999, "card_expired"],
  ["TXN-1007", "PRD-207", "CUS-307", "Kabir Nair", "+15555550107", 1899, "bank_unavailable"],
  ["TXN-1008", "PRD-208", "CUS-308", "Ishita Sen", "+15555550108", 399, "payment_method_declined"],
  ["TXN-1009", "PRD-209", "CUS-309", "Neel Joshi", "+15555550109", 1599, "insufficient_funds"],
  ["TXN-1010", "PRD-210", "CUS-310", "Tara Bose", "+15555550110", 699, "bank_unavailable"]
].map(([transactionId, productId, customerId, customerName, customerPhoneNumber, amount, failureReason], index) => ({
  transactionId,
  productId,
  customerId,
  customerName,
  customerPhoneNumber,
  amount,
  currency: "INR",
  failureReason,
  failedAt: new Date(Date.now() - (index + 1) * 86400000).toISOString().slice(0, 10),
  status: "pending",
  attemptCount: 0,
  attempts: [],
  call: null
}));

function readRecords() {
  if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(seedRecords, null, 2));
  return JSON.parse(fs.readFileSync(DB, "utf8"));
}

function writeRecords(records) {
  fs.writeFileSync(DB, JSON.stringify(records, null, 2));
}

function updateRecord(transactionId, update) {
  const records = readRecords();
  const record = records.find(item => item.transactionId === transactionId);
  if (!record) return null;
  update(record);
  writeRecords(records);
  return record;
}

function logTurn(record, speaker, text) {
  record.call ||= { answers: {}, transcript: "" };
  record.call.transcript = `${record.call.transcript || ""}${speaker}: ${text}\n`;
}

const YES = /\b(yes|yeah|yep|sure|ok|okay|haan|correct|right)\b/i;
const WORD_DAYS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30 };

function parseDays(text) {
  if (/tomorrow/i.test(text)) return 1;
  const match = text.match(/\d+/)?.[0] || Object.keys(WORD_DAYS).find(word => new RegExp(`\\b${word}\\b`, "i").test(text));
  const count = match ? (WORD_DAYS[match] || Number(match)) : null;
  return count && /week/i.test(text) ? count * 7 : count;
}

app.use(express.json(), express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  if (req.path === "/voice" || req.path === "/status") return next();
  if (DASHBOARD_USERNAME && DASHBOARD_PASSWORD) {
    const expected = `Basic ${Buffer.from(`${DASHBOARD_USERNAME}:${DASHBOARD_PASSWORD}`).toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.set("WWW-Authenticate", 'Basic realm="Tandem recovery", charset="UTF-8"');
      return res.status(401).send("Authentication required.");
    }
  } else if (DASHBOARD_USERNAME || DASHBOARD_PASSWORD) {
    return res.status(500).send("Set both DASHBOARD_USERNAME and DASHBOARD_PASSWORD.");
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function verifyTwilioWebhook(req, res, next) {
  if (!process.env.TWILIO_TOKEN || !PUBLIC_URL) return res.sendStatus(503);
  const signature = req.headers["x-twilio-signature"] || "";
  const url = `${PUBLIC_URL}${req.originalUrl}`;
  if (!twilio.validateRequest(process.env.TWILIO_TOKEN, signature, url, req.body)) return res.sendStatus(403);
  next();
}

app.get("/api/config", (_req, res) => res.json({
  telephonyReady: Boolean(client && process.env.TWILIO_FROM && PUBLIC_URL && DEMO_PHONE && DASHBOARD_USERNAME && DASHBOARD_PASSWORD),
  outboundEnabled: process.env.ALLOW_OUTBOUND_CALLS === "true",
  demoPhoneConfigured: Boolean(DEMO_PHONE)
}));

app.get("/api/records", (_req, res) => res.json(readRecords()));

app.post("/api/records", (req, res) => {
  const { transactionId, productId, customerId, customerName, customerPhoneNumber, amount, failureReason } = req.body;
  if (![transactionId, productId, customerId, customerName, customerPhoneNumber, failureReason].every(value => typeof value === "string" && value.trim()) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "All transaction, customer, failure reason, and positive amount fields are required." });
  }

  const records = readRecords();
  if (records.some(record => record.transactionId === transactionId.trim())) {
    return res.status(409).json({ error: "That transaction ID already exists." });
  }

  const record = {
    transactionId: transactionId.trim(), productId: productId.trim(), customerId: customerId.trim(),
    customerName: customerName.trim(), customerPhoneNumber: customerPhoneNumber.trim(),
    amount: Number(amount), currency: "INR", failureReason: failureReason.trim(),
    failedAt: new Date().toISOString().slice(0, 10), status: "pending", attemptCount: 0, attempts: [], call: null
  };
  records.unshift(record);
  writeRecords(records);
  res.status(201).json(record);
});

app.patch("/api/records/:id/paid", (req, res) => {
  const record = updateRecord(req.params.id, item => {
    item.status = "paid";
    item.paidAt = new Date().toISOString();
    item.retryOn = null;
  });
  if (!record) return res.status(404).json({ error: "Transaction not found." });
  res.json(record);
});

app.post("/api/simulate/:id", (req, res) => {
  const { step, text = "" } = req.body;
  const existing = readRecords().find(item => item.transactionId === req.params.id);
  if (!existing) return res.status(404).json({ error: "Transaction not found." });
  if (existing.status === "paid") return res.status(409).json({ error: "This transaction is already paid; no further calls are allowed." });
  const record = updateRecord(req.params.id, item => {
    if (step === "intro" || !item.call || item.call.mode !== "simulation") {
      item.attemptCount += 1;
      item.attempts ||= [];
      item.call = { mode: "simulation", answers: {}, transcript: "", startedAt: new Date().toISOString() };
      item.attempts.push({ number: item.attemptCount, mode: "simulation", startedAt: item.call.startedAt });
    }

    const answer = String(text).trim();
    if (answer) logTurn(item, "Customer", answer);
    if (step === "intro") {
      logTurn(item, "Agent", "This is an automated payment reminder. Is it okay to continue?");
      item.call.simStep = "consent";
    } else if (step === "consent") {
      if (!YES.test(answer)) {
        logTurn(item, "Agent", "Understood. We will not continue this call.");
        item.call.simStep = "ended";
      } else {
        logTurn(item, "Agent", `The autopay for ${item.customerName}, transaction ${item.transactionId}, failed because ${item.failureReason.replaceAll("_", " ")}. What do you think caused the issue?`);
        item.call.simStep = "reason";
      }
    } else if (step === "reason") {
      item.call.answers.customerExplanation = answer;
      logTurn(item, "Agent", "Would you like to pay now, or should we retry later? If later, after how many days?");
      item.call.simStep = "retry";
    } else if (step === "retry") {
      const days = parseDays(answer);
      const payNow = /\b(now|paid|pay now)\b/i.test(answer);
      if (!days && !payNow) {
        logTurn(item, "Agent", "Please say pay now, or give a number of days, such as three days.");
        item.call.simStep = "retry";
      } else {
        item.call.answers.retryAfterDays = payNow ? 0 : days;
        item.status = payNow ? "payment_requested" : "retry_scheduled";
        item.paymentRequestedAt = payNow ? new Date().toISOString() : null;
        item.retryOn = payNow ? null : new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        logTurn(item, "Agent", payNow ? "Thank you. I have recorded that you want to pay now. This transaction will stay open until payment is confirmed." : `Okay. A follow-up is scheduled for ${item.retryOn}. Goodbye.`);
        item.call.simStep = "ended";
      }
    }
  });

  if (!record) return res.status(404).json({ error: "Transaction not found." });
  res.json(record);
});

app.post("/api/call/:id", async (req, res) => {
  if (process.env.ALLOW_OUTBOUND_CALLS !== "true") return res.status(403).json({ error: "Outbound calls are disabled. Set ALLOW_OUTBOUND_CALLS=true only after verifying the demo destination is yours or authorized." });
  if (!client || !PUBLIC_URL || !DEMO_PHONE || !DASHBOARD_USERNAME || !DASHBOARD_PASSWORD) return res.status(400).json({ error: "Configure Twilio, dashboard authentication, PUBLIC_URL, and DEMO_PHONE first." });
  if (req.body.authorized !== true) return res.status(400).json({ error: "Explicit authorization for the demo destination is required." });
  if (req.body.confirmNumber !== DEMO_PHONE) return res.status(400).json({ error: "Type the configured demo phone number to confirm the call destination." });

  const current = readRecords().find(item => item.transactionId === req.params.id);
  if (!current) return res.status(404).json({ error: "Transaction not found." });
  if (current.status === "paid") return res.status(409).json({ error: "This transaction is already paid; no further calls are allowed." });
  if (current.status === "calling") return res.status(409).json({ error: "A call is already in progress for this transaction." });

  try {
    updateRecord(current.transactionId, item => {
      item.status = "calling";
      item.attemptCount += 1;
      item.call = { mode: "phone", answers: {}, transcript: "", startedAt: new Date().toISOString() };
      item.attempts ||= [];
      item.attempts.push({ number: item.attemptCount, mode: "phone", startedAt: item.call.startedAt });
    });
    const call = await client.calls.create({
      to: DEMO_PHONE,
      from: process.env.TWILIO_FROM,
      url: `${PUBLIC_URL}/voice?id=${encodeURIComponent(current.transactionId)}`,
      method: "POST",
      statusCallback: `${PUBLIC_URL}/status?id=${encodeURIComponent(current.transactionId)}`,
      statusCallbackEvent: ["completed"]
    });
    updateRecord(current.transactionId, item => { item.call.sid = call.sid; });
    res.json({ ok: true, sid: call.sid, destination: DEMO_PHONE });
  } catch (error) {
    updateRecord(current.transactionId, item => { item.status = "call_failed"; item.call.error = error.message; });
    res.status(502).json({ error: error.message });
  }
});

function ask(transactionId, text, next) {
  updateRecord(transactionId, item => logTurn(item, "Agent", text));
  const response = new VoiceResponse();
  const gather = response.gather({
    input: "speech", language: "en-IN", speechTimeout: "auto", timeout: 7,
    action: `${PUBLIC_URL}/voice?id=${encodeURIComponent(transactionId)}&step=${next}`,
    method: "POST"
  });
  gather.say({ language: "en-IN" }, text);
  response.redirect({ method: "POST" }, `${PUBLIC_URL}/voice?id=${encodeURIComponent(transactionId)}&step=repeat`);
  return response;
}

function endCall(transactionId, text) {
  updateRecord(transactionId, item => logTurn(item, "Agent", text));
  const response = new VoiceResponse();
  response.say({ language: "en-IN" }, text);
  response.hangup();
  return response;
}

app.post("/voice", verifyTwilioWebhook, (req, res) => {
  const transactionId = String(req.query.id || "");
  const step = String(req.query.step || "intro");
  const said = String(req.body.SpeechResult || "").trim();
  const record = readRecords().find(item => item.transactionId === transactionId);
  if (!record) return res.type("text/xml").send(new VoiceResponse().hangup().toString());
  if (record.status === "paid") return res.type("text/xml").send(endCall(transactionId, "This transaction is already marked paid. Goodbye.").toString());
  if (said) updateRecord(transactionId, item => logTurn(item, "Customer", said));

  let response;
  if (step === "intro") response = ask(transactionId, "Hello. This is an automated payment reminder. Is it okay to continue?", "consent");
  else if (step === "consent") {
    if (!YES.test(said)) response = endCall(transactionId, "Understood. We will not continue this call. Goodbye.");
    else response = ask(transactionId, `The autopay for ${record.customerName}, transaction ${record.transactionId}, failed because ${record.failureReason.replaceAll("_", " ")}. What do you think caused the issue?`, "reason");
  } else if (step === "reason") {
    updateRecord(transactionId, item => { item.call.answers.customerExplanation = said; });
    response = ask(transactionId, "Would you like to pay now, or should we retry later? If later, after how many days?", "retry");
  } else if (step === "retry") {
    const days = parseDays(said);
    const payNow = /\b(now|paid|pay now)\b/i.test(said);
    if (!days && !payNow) response = ask(transactionId, "Please say pay now, or give a number of days, such as three days.", "retry");
    else {
      updateRecord(transactionId, item => {
        item.call.answers.retryAfterDays = payNow ? 0 : days;
        item.status = payNow ? "payment_requested" : "retry_scheduled";
        item.paymentRequestedAt = payNow ? new Date().toISOString() : null;
        item.retryOn = payNow ? null : new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      });
      response = endCall(transactionId, payNow ? "Thank you. I have recorded that you want to pay now. This transaction will stay open until payment is confirmed. Goodbye." : `Okay. A follow-up is scheduled in ${days} days. Goodbye.`);
    }
  } else response = endCall(transactionId, "Thank you. Goodbye.");

  res.type("text/xml").send(response.toString());
});

app.post("/status", verifyTwilioWebhook, (req, res) => {
  updateRecord(String(req.query.id || ""), item => {
    item.call ||= { answers: {}, transcript: "" };
    item.call.providerStatus = req.body.CallStatus;
    if (item.status === "calling") item.status = req.body.CallStatus === "completed" ? "contacted" : "call_failed";
  });
  res.sendStatus(200);
});

app.listen(PORT, "127.0.0.1", () => {
  readRecords();
  console.log(`Autopay recovery demo listening at http://127.0.0.1:${PORT}`);
});