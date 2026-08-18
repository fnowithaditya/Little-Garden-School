// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCFv0Pmc8a684gCO7e96pZF2dEma0Basr4",
    authDomain: "school-management-7570a.firebaseapp.com",
    projectId: "school-management-7570a",
    storageBucket: "school-management-7570a.firebasestorage.app",
    messagingSenderId: "1001418504336",
    appId: "1:1001418504336:web:506d773e5974f86107c015"
};

const app = firebase.initializeApp(firebaseConfig);
const db = app.firestore();

let activeStudent = null;
let fullReceiptText = "";

// --- AUTO-RESTORE PARENT SESSION ON PAGE LOAD / REFRESH ---
window.addEventListener('DOMContentLoaded', async () => {
    const savedSession = localStorage.getItem('lg_parent_session');
    if (savedSession) {
        try {
            const parsed = JSON.parse(savedSession);
            // Re-fetch latest student data from Firestore in case balance updated
            const docRef = await db.collection("students").doc(parsed.id).get();
            if (docRef.exists) {
                activeStudent = { id: docRef.id, ...docRef.data() };
                renderParentDashboard();
            } else {
                // If student no longer exists, clear storage
                localStorage.removeItem('lg_parent_session');
            }
        } catch (e) {
            console.error("Session restore error:", e);
            localStorage.removeItem('lg_parent_session');
        }
    }
});

// --- 1. PARENT LOGIN PROCESSOR ---
async function handleParentLogin(e) {
    e.preventDefault();
    const enteredId = document.getElementById('parentLoginId').value.trim().toUpperCase();
    const enteredPass = document.getElementById('parentLoginPass').value.trim();
    const errorBox = document.getElementById('portalLoginError');

    errorBox.style.display = 'none';

    try {
        let matchedDoc = null;

        // Query by assigned student ID
        const snap = await db.collection("students").where("studentId", "==", enteredId).get();

        if (!snap.empty) {
            snap.forEach(doc => {
                const data = doc.data() || {};
                const validPassword = data.password || String(data.phone || "").slice(-10);
                if (validPassword === enteredPass) {
                    matchedDoc = { id: doc.id, ...data };
                }
            });
        } else {
            // Fallback match for legacy records
            const allSnap = await db.collection("students").get();
            allSnap.forEach(doc => {
                const data = doc.data() || {};
                const fallbackId = `LG2026-${doc.id.slice(0, 3).toUpperCase()}`;
                const validPassword = data.password || String(data.phone || "").slice(-10);

                if ((enteredId === fallbackId || enteredId === String(data.phone)) && validPassword === enteredPass) {
                    matchedDoc = { id: doc.id, ...data, studentId: fallbackId };
                }
            });
        }

        if (!matchedDoc) {
            errorBox.innerText = "Invalid Student ID or Password. Default password is the registered 10-digit mobile number.";
            errorBox.style.display = 'block';
            return;
        }

        activeStudent = matchedDoc;
        
        // PERSIST SESSION TO LOCALSTORAGE
        localStorage.setItem('lg_parent_session', JSON.stringify({
            id: activeStudent.id,
            studentId: activeStudent.studentId
        }));

        renderParentDashboard();
    } catch (err) {
        errorBox.innerText = "Error accessing portal: " + err.message;
        errorBox.style.display = 'block';
    }
}

// --- 2. RENDER PARENT DASHBOARD ---
async function renderParentDashboard() {
    document.getElementById('portal-login-view').style.display = 'none';
    const dash = document.getElementById('portal-dashboard-view');
    dash.style.display = 'flex';
    document.getElementById('portalLogoutBtn').style.display = 'inline-flex';

    const displayStudentId = activeStudent.studentId || `LG2026-${activeStudent.id.slice(0, 3).toUpperCase()}`;

    document.getElementById('p-student-name').innerHTML = `
        ${activeStudent.name} 
        <span style="font-size: 0.85rem; font-family: monospace; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; padding: 3px 10px; border-radius: var(--radius-full); border: 1px solid rgba(99, 102, 241, 0.4); margin-left: 8px; vertical-align: middle;">
            ID: ${displayStudentId}
        </span>
    `;
    
    document.getElementById('p-student-meta').innerText = `Class: ${activeStudent.class || 'N/A'} | Guardian Contact: +91 ${activeStudent.phone}`;
    document.getElementById('p-monthly-fee').innerText = `₹${Number(activeStudent.monthlyFee || 0).toLocaleString('en-IN')}`;
    document.getElementById('p-total-paid').innerText = `₹${Number(activeStudent.totalPaid || 0).toLocaleString('en-IN')}`;
    
    const due = Number(activeStudent.amount || 0);
    document.getElementById('p-due-amt').innerText = `₹${due.toLocaleString('en-IN')}`;

    const statusPill = document.getElementById('p-status-pill');
    if (due <= 0) {
        statusPill.innerText = "🟢 No Dues Pending";
        statusPill.style.background = "rgba(16, 185, 129, 0.15)";
        statusPill.style.borderColor = "rgba(16, 185, 129, 0.4)";
        statusPill.style.color = "#34d399";
    } else {
        statusPill.innerText = "🔴 Balance Due";
        statusPill.style.background = "rgba(239, 68, 68, 0.15)";
        statusPill.style.borderColor = "rgba(239, 68, 68, 0.4)";
        statusPill.style.color = "#f87171";
        document.getElementById('payAmountInput').value = due;
    }

    await loadParentLedger();
}

// --- 3. FETCH TRANSACTION LEDGER ---
async function loadParentLedger() {
    const container = document.getElementById('parentHistoryContainer');
    container.innerHTML = '<p style="color:var(--text-dim); font-size:0.85rem;">Loading transactions...</p>';

    const snap = await db.collection("students").doc(activeStudent.id)
        .collection("paymentHistory")
        .orderBy("timestamp", "desc")
        .get();

    if (snap.empty) {
        container.innerHTML = '<p style="color:var(--text-dim); font-size:0.85rem;">No historical payment logs on record yet.</p>';
        return;
    }

    container.innerHTML = '';
    snap.forEach(doc => {
        const log = doc.data() || {};
        const amt = Number(log.amount || 0);
        const isAdj = log.type === 'adjustment';

        const row = document.createElement('div');
        row.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.35); padding:12px 16px; border-radius:var(--radius-sm); border:1px solid var(--glass-border);";

        row.innerHTML = `
            <div>
                <b style="color:${isAdj ? '#a5b4fc' : '#34d399'}">${amt >= 0 ? `₹${amt}` : `-₹${Math.abs(amt)}`}</b>
                <small style="color:var(--text-muted); margin-left:8px;">(${log.note || 'Fee Settlement'})</small><br>
                <small style="color:var(--text-dim); font-size:11px;">Remaining Due: ₹${log.remainingDue !== undefined ? log.remainingDue : '-'}</small>
            </div>
            <small style="color:var(--text-dim);">${log.date || '-'}</small>
        `;
        container.appendChild(row);
    });
}

// --- 4. LUXURY CLASSY UPI CHECKOUT & QR DISPLAY ---
function initiateFeePayment() {
    const amt = Number(document.getElementById('payAmountInput').value);
    if (!amt || amt <= 0) {
        alert("Please enter a valid payment amount.");
        return;
    }

    const schoolVpa = "little07@idfcbank";
    const schoolName = "Little Garden Play School";
    const studentTag = `${activeStudent.name} (${activeStudent.studentId || 'LG2026'})`;
    const note = `Fee - ${studentTag}`;

    // Standard NPCI UPI URI
    const upiUri = `upi://pay?pa=${encodeURIComponent(schoolVpa)}&pn=${encodeURIComponent(schoolName)}&am=${amt}&cu=INR&tn=${encodeURIComponent(note)}`;

    // If Parent is on mobile device -> Open native UPI apps directly
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        window.location.href = upiUri;
        return;
    }

    // High-Res Static QR source
    const qrImageSource = "qr.png";

    document.getElementById('receiptModalTitle').innerText = "⚡ Instant UPI Fee Payment";
    const previewBox = document.getElementById('receipt-preview-box');
    
    previewBox.innerHTML = `
        <div class="qr-card-container">
            <span class="badge-pill" style="font-size:0.72rem; padding:4px 12px; margin-bottom:8px; border-color:rgba(16,185,129,0.3); color:#34d399; background:rgba(16,185,129,0.1);">
                ✓ NPCI Verified Direct Merchant
            </span>
            <h4 style="margin: 4px 0 2px 0; color:#ffffff; font-size:1.15rem;">₹${amt.toLocaleString('en-IN')}</h4>
            <p style="color:var(--text-dim); font-size:0.78rem;">Settling fees for <b>${activeStudent.name}</b></p>
            
            <div class="qr-frame">
                <img src="${qrImageSource}" alt="Little Garden UPI QR" onerror="this.src='https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUri)}'">
            </div>

            <div>
                <div class="upi-chip" onclick="copyUpiId('${schoolVpa}')" title="Click to copy UPI ID">
                    <span>ID: <b>${schoolVpa}</b></span>
                    <span style="font-size:0.75rem;">📋 Copy</span>
                </div>
            </div>

            <div style="background: rgba(16, 185, 129, 0.06); border: 1px dashed rgba(16, 185, 129, 0.25); border-radius: var(--radius-md); padding: 12px; margin-top: 10px; text-align: left;">
                <label style="font-size: 0.75rem; color: #34d399; font-weight: 700; display: block; margin-bottom: 6px;">
                    1. Pay via GPay / PhonePe / Paytm / BHIM<br>
                    2. Enter 12-Digit UPI Ref / UTR to Confirm:
                </label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="upiUtrNumber" placeholder="Enter 12-digit UTR No." maxlength="16" style="padding: 9px 12px; font-size: 0.85rem; font-family: monospace;">
                    <button class="btn-action btn-primary" style="padding: 8px 16px; font-size: 0.82rem; white-space: nowrap;" onclick="confirmUpiPaymentSubmission(${amt})">Confirm</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modalActionBtn').style.display = 'none';
    document.getElementById('receiptModal').style.display = 'flex';
}

// --- 5. UTR VERIFICATION & BALANCE UPDATE ---
async function confirmUpiPaymentSubmission(amt) {
    const utrInput = document.getElementById('upiUtrNumber');
    const utr = utrInput ? utrInput.value.trim() : '';

    if (!utr || utr.length < 8) {
        alert("Please enter a valid 12-digit UPI Reference / UTR Number from your bank transaction screen.");
        return;
    }

    const nowStr = new Date().toLocaleString('en-IN');
    const currentDue = Number(activeStudent.amount || 0);
    const newDue = Math.max(0, currentDue - amt);
    const newTotalPaid = Number(activeStudent.totalPaid || 0) + amt;

    const docRef = db.collection("students").doc(activeStudent.id);

    try {
        await docRef.update({
            amount: newDue,
            totalPaid: newTotalPaid,
            lastPaidAmt: amt,
            lastPaymentDate: nowStr,
            isPaid: (newDue <= 0)
        });

        await docRef.collection("paymentHistory").add({
            amount: amt,
            type: "payment",
            method: "UPI Direct (IDFC)",
            note: `UPI UTR Ref: ${utr}`,
            remainingDue: newDue,
            date: nowStr,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`🎉 Payment of ₹${amt} logged successfully!\nUTR Reference: ${utr}\nYour balance has been updated.`);
        document.getElementById('receiptModal').style.display = 'none';
        
        activeStudent.amount = newDue;
        activeStudent.totalPaid = newTotalPaid;
        renderParentDashboard();
    } catch (err) {
        alert("Error logging payment: " + err.message);
    }
}

// --- 6. RECEIPT BUILDER & STATEMENTS ---
async function openCompleteReceipt() {
    const txnId = 'LG-PR-' + Math.floor(100000 + Math.random() * 900000);
    const currentDate = new Date().toLocaleDateString('en-IN');
    const displayStudentId = activeStudent.studentId || `LG2026-${activeStudent.id.slice(0, 3).toUpperCase()}`;

    let historyTable = "";
    const snap = await db.collection("students").doc(activeStudent.id)
        .collection("paymentHistory")
        .orderBy("timestamp", "asc")
        .get();

    snap.forEach((doc, idx) => {
        const log = doc.data() || {};
        historyTable += `${idx + 1}. [${log.date || '-'}]\n   Paid : ₹${log.amount} via ${log.method || 'Online/Cash'}\n   Bal  : ₹${log.remainingDue}\n\n`;
    });

    fullReceiptText = 
`========================================
         LITTLE GARDEN SCHOOL
        STUDENT FEE STATEMENT
========================================
Statement ID    : ${txnId}
Date Generated  : ${currentDate}
Student Name    : ${activeStudent.name}
Student ID      : ${displayStudentId}
Class           : ${activeStudent.class}
Contact         : ${activeStudent.phone}
----------------------------------------
Monthly Fee Rate : ₹${activeStudent.monthlyFee}
----------------------------------------
📜 TRANSACTION LEDGER
----------------------------------------
${historyTable || 'No transactions recorded.\n'}----------------------------------------
Total Cleared : ₹${activeStudent.totalPaid || 0}
Current Due   : ₹${activeStudent.amount || 0}
Status        : ${activeStudent.amount <= 0 ? 'PAID IN FULL (NO DUES)' : 'BALANCE DUE'}
========================================`;

    document.getElementById('receiptModalTitle').innerText = "🧾 Official Fee Statement";
    const previewBox = document.getElementById('receipt-preview-box');
    previewBox.innerHTML = `<div style="background: rgba(0,0,0,0.5); border: 1px dashed var(--glass-border); padding: 14px; border-radius: 12px; font-family: monospace; white-space: pre-wrap; font-size: 0.8rem; color: #e2e8f0; max-height: 58vh; overflow-y: auto;">${fullReceiptText}</div>`;
    
    document.getElementById('modalActionBtn').style.display = 'inline-flex';
    document.getElementById('receiptModal').style.display = 'flex';
}

function copyReceiptText() {
    if (!fullReceiptText) return;
    navigator.clipboard.writeText(fullReceiptText);
    alert("Official Statement copied to clipboard!");
}

function copyUpiId(upiId) {
    navigator.clipboard.writeText(upiId);
    alert(`UPI ID "${upiId}" copied to clipboard!`);
}

// --- 7. LOGOUT & CLEAR SESSION ---
function handleParentLogout() {
    activeStudent = null;
    localStorage.removeItem('lg_parent_session'); // Clears saved session
    document.getElementById('portal-dashboard-view').style.display = 'none';
    document.getElementById('portal-login-view').style.display = 'block';
    document.getElementById('portalLogoutBtn').style.display = 'none';
    document.getElementById('parentLoginForm').reset();
}
