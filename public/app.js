const rowsElement = document.querySelector("#transaction-rows");
const detailsPanel = document.querySelector("#details-panel");
const detailContent = document.querySelector("#detail-content");
const scrim = document.querySelector("#scrim");
const addDialog = document.querySelector("#add-dialog");
const callDialog = document.querySelector("#call-dialog");
const searchInput = document.querySelector("#search");
const records = new Map();
let currentFilter = "all";
let selectedId = null;
let config = {};
let simulationSending = false;
let toastTimer;

const labelFor = value => String(value || "").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
const shortDate = value => value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function notify(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function visibleRecords() {
  const term = searchInput.value.trim().toLowerCase();
  return [...records.values()].filter(record => {
    const matchesFilter = currentFilter === "all" || (currentFilter === "open"
      ? !["paid"].includes(record.status)
      : record.status === currentFilter);
    const searchBlob = [record.transactionId, record.productId, record.customerId, record.customerName, record.customerPhoneNumber, record.failureReason].join(" ").toLowerCase();
    return matchesFilter && (!term || searchBlob.includes(term));
  });
}

function render() {
  const all = [...records.values()];
  const unpaid = all.filter(record => record.status !== "paid");
  document.querySelector("#metric-balance").textContent = money(unpaid.reduce((total, record) => total + Number(record.amount), 0));
  document.querySelector("#metric-open").textContent = unpaid.length;
  document.querySelector("#metric-attempts").textContent = all.reduce((total, record) => total + Number(record.attemptCount || 0), 0);
  document.querySelector("#metric-recovered").textContent = all.filter(record => record.status === "paid").length;
  document.querySelector("#count-all").textContent = all.length;
  document.querySelector("#count-open").textContent = unpaid.length;
  document.querySelector("#count-retry").textContent = all.filter(record => record.status === "retry_scheduled").length;
  document.querySelector("#count-paid").textContent = all.filter(record => record.status === "paid").length;

  const shown = visibleRecords();
  rowsElement.innerHTML = shown.map(record => `
    <tr data-id="${escapeHtml(record.transactionId)}">
      <td><span class="transaction-id">${escapeHtml(record.transactionId)}</span><span class="cell-secondary">${escapeHtml(record.productId)} · ${escapeHtml(shortDate(record.failedAt))}</span></td>
      <td><span class="customer-name">${escapeHtml(record.customerName)}</span><span class="cell-secondary">${escapeHtml(record.customerId)}</span></td>
      <td><span class="failure-reason">${escapeHtml(labelFor(record.failureReason))}</span></td>
      <td><span class="amount">${escapeHtml(money(record.amount))}</span></td>
      <td><span class="attempt-count">${Number(record.attemptCount || 0).toString().padStart(2, "0")}</span></td>
      <td><span class="status-pill status-${escapeHtml(record.status)}">${escapeHtml(labelFor(record.status))}</span></td>
      <td><button class="row-open" type="button" data-open="${escapeHtml(record.transactionId)}" aria-label="Open ${escapeHtml(record.transactionId)} details">›</button></td>
    </tr>`).join("");
  document.querySelector("#empty-state").hidden = shown.length > 0;
  document.querySelector("#result-count").textContent = `Showing ${shown.length} transaction${shown.length === 1 ? "" : "s"}`;
  if (selectedId && records.has(selectedId) && detailsPanel.classList.contains("open")) renderDetails(records.get(selectedId));
}

async function refresh() {
  const [list, settings] = await Promise.all([api("/api/records"), api("/api/config")]);
  records.clear();
  list.forEach(record => records.set(record.transactionId, record));
  config = settings;
  render();
}

function detailItem(label, value) {
  return `<div class="detail-item"><label>${escapeHtml(label)}</label><strong>${escapeHtml(value)}</strong></div>`;
}

function openDetails(transactionId) {
  selectedId = transactionId;
  renderDetails(records.get(transactionId));
  detailsPanel.classList.add("open");
  detailsPanel.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDetails() {
  detailsPanel.classList.remove("open");
  detailsPanel.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  document.body.style.overflow = "";
}

function renderDetails(record) {
  if (!record) return;
  document.querySelector("#detail-title").textContent = record.transactionId;
  const initials = record.customerName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const transcript = record.call?.transcript || "Your conversation transcript will appear here.";
  const inProgress = record.call?.mode === "simulation" && !["ended"].includes(record.call?.simStep);
  const canCall = record.status !== "paid" && record.status !== "calling";
  const attempts = (record.attempts || []).map(attempt => `<div class="attempt-row"><span>Attempt ${attempt.number} · ${escapeHtml(labelFor(attempt.mode))}</span><time>${escapeHtml(new Date(attempt.startedAt).toLocaleString())}</time></div>`).join("");
  const answerSummary = record.call?.answers?.customerExplanation
    ? `<div class="detail-grid">${detailItem("CUSTOMER EXPLANATION", record.call.answers.customerExplanation)}${detailItem("RETRY AFTER", record.call.answers.retryAfterDays === 0 ? "Paid now" : `${record.call.answers.retryAfterDays} days`)}</div>`
    : "";

  detailContent.innerHTML = `
    <div class="detail-customer"><span class="avatar">${escapeHtml(initials)}</span><div><strong>${escapeHtml(record.customerName)}</strong><span>${escapeHtml(record.customerId)} · ${escapeHtml(record.customerPhoneNumber)}</span></div></div>
    <div class="detail-grid">
      ${detailItem("PRODUCT", record.productId)}${detailItem("AMOUNT", money(record.amount))}
      ${detailItem("FAILED ON", shortDate(record.failedAt))}${detailItem("FAILURE REASON", labelFor(record.failureReason))}
      ${detailItem("STATUS", labelFor(record.status))}${detailItem("RETRY DATE", record.retryOn ? shortDate(record.retryOn) : "—")}
    </div>
    ${answerSummary}
    <div class="panel-actions">
      <button class="primary-button" type="button" data-action="simulate" ${canCall ? "" : "disabled"}>${record.call?.mode === "simulation" && record.call?.simStep === "ended" ? "Start next simulation" : "Simulate agent"} <span aria-hidden="true">▷</span></button>
      <button class="secondary-button" type="button" data-action="call" ${canCall && config.outboundEnabled && config.telephonyReady ? "" : "disabled"} title="${config.outboundEnabled && config.telephonyReady ? "Call only the configured demo phone" : "Configure and explicitly enable Twilio outbound calls"}">Call demo phone <span aria-hidden="true">↗</span></button>
      <button class="secondary-button mark-paid" type="button" data-action="paid" ${record.status === "paid" ? "disabled" : ""}>${record.status === "paid" ? "Marked paid" : "Mark as paid"}</button>
    </div>
    ${record.status !== "paid" ? `<p class="sim-hint">Confirm payment in your payment system before marking this transaction paid. This demo does not process payments.</p>` : ""}
    <p class="section-label">VOICE AGENT · LOCAL SIMULATION</p>
    <div class="simulation">
      <div class="simulation-top"><strong>Conversation</strong><span>${record.call?.mode === "phone" ? "TWILIO PHONE" : "NO AUDIO RECORDED"}</span></div>
      <div class="transcript ${record.call?.transcript ? "" : "transcript-empty"}" id="transcript">${escapeHtml(transcript)}</div>
      ${inProgress ? `<div class="sim-controls"><div id="sim-choices" class="sim-choices"></div><div class="sim-input-row"><input id="sim-answer" aria-label="Customer's simulated response" placeholder="Type a customer response" autocomplete="off"><button type="button" data-action="send-simulation">Send</button></div><p class="sim-hint">This local simulation stores the responses and transcript in data.json. It does not place a call or capture audio.</p></div>` : ""}
    </div>
    <div class="attempt-history">${attempts}</div>
    ${record.status !== "paid" ? `<p class="sim-hint">Each attempt is started manually. A retry date is recorded, but this demo does not automatically dial or charge customers.</p>` : ""}`;

  if (inProgress) {
    const step = record.call.simStep;
    const choices = step === "consent" ? [["Yes, continue", "yes"], ["No", "no"]]
      : step === "retry" ? [["Pay now", "pay now"], ["Retry in 3 days", "in 3 days"], ["Retry in 7 days", "in 7 days"]] : [];
    document.querySelector("#sim-choices").innerHTML = choices.map(([label, answer]) => `<button class="choice-button" type="button" data-answer="${escapeHtml(answer)}">${escapeHtml(label)}</button>`).join("");
  }
}

async function startSimulation() {
  if (simulationSending) return;
  simulationSending = true;
  try {
    const record = await api(`/api/simulate/${encodeURIComponent(selectedId)}`, { method: "POST", body: JSON.stringify({ step: "intro" }) });
    records.set(record.transactionId, record);
    render();
    notify("Simulation started. Review the prompt and respond as the customer.");
  } catch (error) { notify(error.message); }
  finally { simulationSending = false; }
}

async function sendSimulation(text) {
  if (simulationSending) return;
  const record = records.get(selectedId);
  if (!record?.call?.simStep || record.call.simStep === "ended") return;
  simulationSending = true;
  try {
    const updated = await api(`/api/simulate/${encodeURIComponent(selectedId)}`, {
      method: "POST", body: JSON.stringify({ step: record.call.simStep, text })
    });
    records.set(updated.transactionId, updated);
    render();
    document.querySelector("#sim-answer")?.focus();
  } catch (error) { notify(error.message); }
  finally { simulationSending = false; }
}

document.querySelector("#add-button").addEventListener("click", () => addDialog.showModal());
document.querySelector("#reload-button").addEventListener("click", () => refresh().then(() => notify("Queue refreshed.")).catch(error => notify(error.message)));
document.querySelector(".close-panel").addEventListener("click", closeDetails);
scrim.addEventListener("click", closeDetails);
searchInput.addEventListener("input", render);

document.querySelectorAll(".filter-tab").forEach(button => button.addEventListener("click", () => {
  currentFilter = button.dataset.filter;
  document.querySelectorAll(".filter-tab").forEach(tab => tab.classList.toggle("active", tab === button));
  render();
}));

document.querySelector("#transaction-rows").addEventListener("click", event => {
  const row = event.target.closest("tr[data-id]");
  if (row) openDetails(row.dataset.id);
});

detailContent.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  if (button.dataset.action === "simulate") return startSimulation();
  if (button.dataset.action === "call") return callDialog.showModal();
  if (button.dataset.action === "send-simulation") return sendSimulation(document.querySelector("#sim-answer").value.trim());
  if (button.dataset.action === "paid") {
    try {
      const record = await api(`/api/records/${encodeURIComponent(selectedId)}/paid`, { method: "PATCH", body: "{}" });
      records.set(record.transactionId, record);
      render();
      notify("Transaction marked paid. Further calls are disabled.");
    } catch (error) { notify(error.message); }
  }
});

detailContent.addEventListener("click", event => {
  const choice = event.target.closest("button[data-answer]");
  if (choice) sendSimulation(choice.dataset.answer);
});

detailContent.addEventListener("keydown", event => {
  if (event.key === "Enter" && event.target.id === "sim-answer") {
    event.preventDefault();
    sendSimulation(event.target.value.trim());
  }
});

detailContent.addEventListener("input", event => {
  if (event.target.id === "sim-answer") {
    const send = detailContent.querySelector('[data-action="send-simulation"]');
    if (send) send.disabled = !event.target.value.trim();
  }
});

document.querySelector("#transaction-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form));
  try {
    const record = await api("/api/records", { method: "POST", body: JSON.stringify(fields) });
    records.set(record.transactionId, record);
    form.reset();
    addDialog.close();
    currentFilter = "all";
    document.querySelectorAll(".filter-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === "all"));
    render();
    openDetails(record.transactionId);
    notify("Failed transaction added to the queue.");
  } catch (error) { notify(error.message); }
});

document.querySelector("#call-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!document.querySelector("#authorize-call").checked) return;
  const confirmNumber = document.querySelector("#confirm-number").value.trim();
  try {
    await api(`/api/call/${encodeURIComponent(selectedId)}`, { method: "POST", body: JSON.stringify({ confirmNumber, authorized: true }) });
    callDialog.close();
    document.querySelector("#call-form").reset();
    await refresh();
    notify("Call started to the configured demo number only.");
  } catch (error) { notify(error.message); }
});

document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close()));
document.addEventListener("keydown", event => {
  if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && detailsPanel.classList.contains("open")) closeDetails();
});

refresh().catch(error => notify(error.message));