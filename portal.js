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

// --- 1. PARENT LOGIN PROCESSOR (STUDENT ID & PASSWORD) ---
async function handleParentLogin(e) {
    e.preventDefault();
    const enteredId = document.getElementById('parentLoginId').value.trim().toUpperCase();
    const enteredPass = document.getElementById('parentLoginPass').value.trim();
    const errorBox = document.getElementById('portalLoginError');

    errorBox.style.display = 'none';

    try {
        let matchedDoc = null;

        // Query by studentId first
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
            // Fallback match for legacy records: check if ID entered matches doc.id or phone
            const allSnap = await db.collection("students").get();
            allSnap.forEach(doc => {
                const data = doc.data() || {};
                const generatedFallbackId = `LG2026-${doc.id.slice(0, 3).toUpperCase()}`;
                const validPassword = data.password || String(data.phone || "").slice(-10);

                if ((enteredId === generatedFallbackId || enteredId === String(data.phone)) && validPassword === enteredPass) {
                    matchedDoc = { id: doc.id, ...data, studentId: generatedFallbackId };
                }
            });
        }

        if (!matchedDoc) {
            errorBox.innerText = "Invalid Student ID or Password. Default password is the registered 10-digit mobile number.";
            errorBox.style.display = 'block';
            return;
        }

        activeStudent = matchedDoc;
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

    // Set Info with ID Badge
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

    // Set Status Pill
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

// --- 4. RAZORPAY PAYMENT INITIATOR ---
async function initiateFeePayment() {
    const amt = Number(document.getElementById('payAmountInput').value);
    if (!amt || amt <= 0) {
        alert("Please enter a valid payment amount.");
        return;
    }

    const options = {
        key: "rzp_test_YourKeyHere", // Replace with your live or test Razorpay Key ID
        amount: amt * 100,
        currency: "INR",
        name: "Little Garden School",
        description: `Fee Payment for ${activeStudent.name} (${activeStudent.studentId || 'LG2026'})`,
        handler: async function (response) {
            const nowStr = new Date().toLocaleString('en-IN');
            const currentDue = Number(activeStudent.amount || 0);
            const newDue = Math.max(0, currentDue - amt);
            const newTotalPaid = Number(activeStudent.totalPaid || 0) + amt;

            const docRef = db.collection("students").doc(activeStudent.id);

            await docRef.update({
                amount: newDue,
                totalPaid: newTotalPaid,
                lastPaidAmt: amt,
                lastPaymentDate: nowStr,
                isPaid: newDue <= 0
            });

            await docRef.collection("paymentHistory").add({
                amount: amt,
                type: "payment",
                method: "Online (Razorpay)",
                note: `Online Txn Ref: ${response.razorpay_payment_id || 'Direct'}`,
                remainingDue: newDue,
                date: nowStr,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            alert(`✅ Payment of ₹${amt} received successfully! Txn ID: ${response.razorpay_payment_id}`);
            
            activeStudent.amount = newDue;
            activeStudent.totalPaid = newTotalPaid;
            renderParentDashboard();
        },
        prefill: {
            name: activeStudent.name,
            contact: activeStudent.phone
        },
        theme: {
            color: "#6366f1"
        }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response) {
        alert("Payment failed or was cancelled: " + response.error.description);
    });
    rzp.open();
}

// --- 5. RECEIPT BUILDER & COPY ---
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

    document.getElementById('receipt-preview-box').innerText = fullReceiptText;
    document.getElementById('receiptModal').style.display = 'flex';
}

function copyReceiptText() {
    if (!fullReceiptText) return;
    navigator.clipboard.writeText(fullReceiptText);
    alert("Official Statement copied to clipboard!");
}

function handleParentLogout() {
    activeStudent = null;
    document.getElementById('portal-dashboard-view').style.display = 'none';
    document.getElementById('portal-login-view').style.display = 'block';
    document.getElementById('portalLogoutBtn').style.display = 'none';
    document.getElementById('parentLoginForm').reset();
}