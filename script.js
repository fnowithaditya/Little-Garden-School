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
const auth = app.auth();

// Global App State
let allStudentsList = [];
let currentStudentId = null;
let currentStudentData = null;
let generatedReceiptText = "";

// --- AUTH STATE OBSERVER ---
auth.onAuthStateChanged(user => {
    const loginOverlay = document.getElementById('loginOverlay');
    if (user) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        loadAllData();
    } else {
        if (loginOverlay) loginOverlay.style.display = 'flex';
    }
});

// --- ADMIN AUTH HANDLERS ---
async function handleAdminLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    const errText = document.getElementById('loginError');

    if (!email || !pass) {
        errText.innerText = "Please enter both email and password.";
        errText.style.display = "block";
        return;
    }

    try {
        errText.style.display = "none";
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
        console.error("Login failed:", err);
        errText.innerText = "Login failed: " + err.message;
        errText.style.display = "block";
    }
}

async function handleAdminLogout() {
    if (confirm("Are you sure you want to log out?")) {
        await auth.signOut();
        window.location.reload();
    }
}

// --- PAGE NAVIGATION ---
function showPage(pageId) {
    document.querySelectorAll('.page-view').forEach(v => v.style.display = 'none');
    const target = document.getElementById(`${pageId}-view`);
    if (target) target.style.display = 'block';

    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (pageId === 'admin') {
        populateAdminStudentDropdown();
        loadAdmissionEnquiries();
    }
}

// --- LOAD ALL STUDENTS ---
async function loadAllData() {
    const tbody = document.getElementById('studentData');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading Finance Data...</td></tr>';

    try {
        const snap = await db.collection("students").orderBy("name", "asc").get();
        allStudentsList = [];
        let totalCount = 0;
        let totalDues = 0;

        snap.forEach(doc => {
            const s = doc.data() || {};
            totalCount++;
            const dueAmt = Number(s.amount || 0);
            totalDues += dueAmt;

            allStudentsList.push({
                id: doc.id,
                studentId: s.studentId || `LG2026-${doc.id.slice(0, 3).toUpperCase()}`,
                password: s.password || String(s.phone || '').slice(-10),
                name: s.name || 'Unnamed Student',
                class: s.class || 'Unassigned',
                phone: s.phone || 'No Phone',
                monthlyFee: Number(s.monthlyFee || 0),
                amount: dueAmt,
                totalPaid: Number(s.totalPaid || 0),
                isPaid: s.isPaid ?? (dueAmt <= 0),
                lastPaidAmt: Number(s.lastPaidAmt || 0),
                lastPaymentDate: s.lastPaymentDate || '-'
            });
        });

        document.getElementById('stat-count').innerText = totalCount;
        document.getElementById('stat-dues').innerText = `₹${totalDues.toLocaleString('en-IN')}`;

        if (allStudentsList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim);">No student records found. Add one above!</td></tr>';
            return;
        }

        renderStudentTable(allStudentsList);
        populateAdminStudentDropdown();
    } catch (err) {
        console.error("Error loading data:", err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444;">Failed to load data: ${err.message}</td></tr>`;
    }
}

function renderStudentTable(students) {
    const tbody = document.getElementById('studentData');
    tbody.innerHTML = '';

    students.forEach(s => {
        const row = document.createElement('tr');
        row.setAttribute('data-name', s.name.toLowerCase());
        row.setAttribute('data-id', s.studentId.toLowerCase());
        row.setAttribute('data-class', s.class);

        row.innerHTML = `
            <td>
                <b>${s.name}</b> <small style="color:var(--primary)">[${s.class}]</small><br>
                <small style="color:#a5b4fc; font-family:monospace; font-weight:700;">ID: ${s.studentId}</small> | 
                <small style="color:var(--text-dim)">📞 ${s.phone}</small>
            </td>
            <td style="color:#ef4444; font-weight:800">₹${s.amount.toLocaleString('en-IN')}</td>
            <td><small>₹${s.lastPaidAmt.toLocaleString('en-IN')}</small><br><small style="font-size:10px; color:var(--text-dim)">${s.lastPaymentDate}</small></td>
            <td>
                <button class="status-pill-ui ${s.isPaid ? 'paid' : 'pending'}" onclick="openProfile('${s.id}')">
                    ${s.isPaid ? 'PAID' : 'PAY DUE'}
                </button>
            </td>
            <td><button class="btn-repair" onclick="openProfile('${s.id}')">Manage</button></td>
        `;
        tbody.appendChild(row);
    });
}

// --- STUDENT REGISTRATION (AUTO-GENERATES ID & PASSWORD) ---
async function addStudentToFirebase(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('studentName').value.trim();
    const phone = document.getElementById('parentPhone').value.trim();
    const stClass = document.getElementById('studentClass').value;
    const fee = Number(document.getElementById('feeAmount').value || 0);

    if (!name) {
        alert("Student Name is required!");
        return;
    }

    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const generatedId = `LG2026-${randomSuffix}`;
    const defaultPassword = phone ? phone.slice(-10) : "123456";

    try {
        await db.collection("students").add({
            studentId: generatedId,
            password: defaultPassword,
            name: name.toUpperCase(),
            phone: phone || "0000000000",
            class: stClass,
            monthlyFee: fee,
            amount: fee,
            totalPaid: 0,
            lastPaidAmt: 0,
            lastPaymentDate: "-",
            isPaid: fee <= 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`✅ Student Registered!\n\nParent Portal Credentials:\nStudent ID: ${generatedId}\nPassword: ${defaultPassword}`);
        document.getElementById('addStudentForm').reset();
        showPage('dashboard');
        loadAllData();
    } catch (err) {
        alert("Registration failed: " + err.message);
    }
}

// --- SEARCH & FILTER ---
function filterStudents() {
    const searchVal = document.getElementById('studentSearch').value.toLowerCase();
    const classVal = document.getElementById('classFilter').value;
    const rows = document.querySelectorAll("#studentData tr");

    rows.forEach(row => {
        const name = row.getAttribute('data-name') || '';
        const stId = row.getAttribute('data-id') || '';
        const stClass = row.getAttribute('data-class') || '';
        const matchSearch = name.includes(searchVal) || stId.includes(searchVal);
        const matchClass = (classVal === 'ALL') || (stClass === classVal);
        row.style.display = (matchSearch && matchClass) ? '' : 'none';
    });
}

// --- PROFILE & QUICK ACTIONS MODAL ---
async function openProfile(studentId) {
    currentStudentId = studentId;
    const docRef = db.collection("students").doc(studentId);
    const doc = await docRef.get();

    if (!doc.exists) {
        alert("Student record not found.");
        return;
    }

    currentStudentData = { id: doc.id, ...doc.data() };
    if (!currentStudentData.studentId) currentStudentData.studentId = `LG2026-${doc.id.slice(0, 3).toUpperCase()}`;

    document.getElementById('m-name').innerText = currentStudentData.name;
    document.getElementById('m-class-info').innerText = `ID: ${currentStudentData.studentId} | Class: ${currentStudentData.class} | Phone: ${currentStudentData.phone} | Due: ₹${currentStudentData.amount}`;
    document.getElementById('quick-pay-amt').value = '';
    document.getElementById('quick-pay-note').value = '';
    document.getElementById('custom-entry-amt').value = '';
    document.getElementById('custom-entry-note').value = '';

    document.getElementById('studentModal').style.display = 'flex';
    fetchPaymentHistory(studentId, 'history-timeline', currentStudentData);
}

function closeModal() {
    document.getElementById('studentModal').style.display = 'none';
}

// --- LOGGING PAYMENTS & ADJUSTMENTS ---
async function recordNewPayment() {
    const payAmt = Number(document.getElementById('quick-pay-amt').value);
    const method = document.getElementById('quick-pay-method').value;
    const note = document.getElementById('quick-pay-note').value.trim();

    if (!payAmt || payAmt <= 0) {
        alert("Please enter a valid payment amount.");
        return;
    }

    const currentDue = Number(currentStudentData.amount || 0);
    const newDue = Math.max(0, currentDue - payAmt);
    const newTotalPaid = Number(currentStudentData.totalPaid || 0) + payAmt;
    const nowStr = new Date().toLocaleString('en-IN');

    const docRef = db.collection("students").doc(currentStudentId);

    await docRef.update({
        amount: newDue,
        totalPaid: newTotalPaid,
        lastPaidAmt: payAmt,
        lastPaymentDate: nowStr,
        isPaid: (newDue <= 0)
    });

    await docRef.collection("paymentHistory").add({
        amount: payAmt,
        type: "payment",
        method: method,
        note: note ? `${note} [${method}]` : `Payment [${method}]`,
        remainingDue: newDue,
        date: nowStr,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert(`Payment of ₹${payAmt} recorded!`);
    openProfile(currentStudentId);
    loadAllData();
}

async function addCustomStudentEntry() {
    const type = document.getElementById('custom-entry-type').value;
    const amt = Number(document.getElementById('custom-entry-amt').value);
    const reason = document.getElementById('custom-entry-note').value.trim();

    if (!amt || amt <= 0 || !reason) {
        alert("Please enter a valid amount and reason.");
        return;
    }

    const currentDue = Number(currentStudentData.amount || 0);
    const newDue = (type === 'add') ? (currentDue + amt) : Math.max(0, currentDue - amt);
    const nowStr = new Date().toLocaleString('en-IN');

    const docRef = db.collection("students").doc(currentStudentId);

    await docRef.update({
        amount: newDue,
        isPaid: (newDue <= 0)
    });

    await docRef.collection("paymentHistory").add({
        amount: (type === 'add' ? amt : -amt),
        type: "adjustment",
        method: "System",
        note: `[${type === 'add' ? 'Fee Added' : 'Discount'}] ${reason}`,
        remainingDue: newDue,
        date: nowStr,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert("Fee adjustment recorded!");
    openProfile(currentStudentId);
    loadAllData();
}

// --- PAYMENT HISTORY & RECEIPT BUILDER ---
async function fetchPaymentHistory(studentId, containerId, studentObj) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<small style="color:var(--text-dim)">Loading history...</small>';

    const snap = await db.collection("students").doc(studentId)
        .collection("paymentHistory")
        .orderBy("timestamp", "desc")
        .get();

    if (snap.empty) {
        container.innerHTML = '<small style="color:var(--text-dim)">No history logged yet.</small>';
        return;
    }

    container.innerHTML = '';
    snap.forEach(doc => {
        const log = doc.data() || {};
        const isAdj = log.type === 'adjustment';
        const displayAmt = log.amount >= 0 ? `₹${log.amount}` : `-₹${Math.abs(log.amount)}`;

        const item = document.createElement('div');
        item.className = `history-item ${isAdj ? 'adjustment' : ''}`;
        item.innerHTML = `
            <div>
                <b>${displayAmt}</b> <span style="font-size:11px; color:var(--text-dim)">(${log.note || 'Payment'})</span><br>
                <small style="font-size:10px; color:var(--text-dim)">Remaining Due: ₹${log.remainingDue}</small><br>
                <button class="btn-repair" style="font-size:10px; padding:2px 8px; margin-top:4px;" onclick='generateSingleReceipt(${JSON.stringify(studentObj)})'>🧾 View Receipt</button>
            </div>
            <small style="color:var(--text-dim)">${log.date || '-'}</small>
        `;
        container.appendChild(item);
    });
}

async function generateSingleReceipt(st) {
    const txnId = 'LG-' + Math.floor(100000 + Math.random() * 900000);
    const currentDate = new Date().toLocaleDateString('en-IN');
    
    let historyLogs = [];
    let totalPaidSum = 0;

    try {
        const snap = await db.collection("students").doc(st.id)
            .collection("paymentHistory")
            .orderBy("timestamp", "asc")
            .get();

        snap.forEach(doc => {
            historyLogs.push(doc.data() || {});
        });
    } catch (err) {
        console.error("Receipt generation error:", err);
    }

    let historyTableText = "";

    if (historyLogs.length > 0) {
        historyLogs.forEach((log, index) => {
            const num = index + 1;
            const entryDate = log.date || '-';
            const rawAmt = Number(log.amount || 0);
            const cleanAmt = Math.abs(rawAmt);
            const methodStr = log.method || 'Cash';
            const remDueStr = log.remainingDue !== undefined ? `₹${log.remainingDue}` : '-';

            let detailsLine = "";
            if (log.type === 'adjustment') {
                const action = rawAmt >= 0 ? 'Fee Added' : 'Discount Given';
                detailsLine = `${action} ₹${cleanAmt} (${log.note || 'Adjustment'})`;
            } else {
                totalPaidSum += rawAmt;
                const noteDetail = log.note ? log.note : `Payment [${methodStr}]`;
                detailsLine = `Paid ₹${cleanAmt} via ${noteDetail}`;
            }

            historyTableText += `${num}. [${entryDate}]\n   Details : ${detailsLine}\n   Bal Due : ${remDueStr}\n\n`;
        });
    } else {
        historyTableText = "No previous transaction records found.\n\n";
    }

    generatedReceiptText = 
`========================================
         LITTLE GARDEN SCHOOL
    COMPLETE STATEMENT & FEE RECEIPT
========================================
Receipt Ref     : ${txnId}
Date Generated  : ${currentDate}
Student Name    : ${st.name}
Student ID      : ${st.studentId || 'N/A'}
Class           : ${st.class}
Contact Phone   : ${st.phone}
----------------------------------------
Base Tuition Fee : ₹${st.monthlyFee}
----------------------------------------
      📜 COMPLETE PAYMENT HISTORY
----------------------------------------
${historyTableText}----------------------------------------
Total Amount Paid (Cumulative) : ₹${totalPaidSum || st.totalPaid || 0}
Current Outstanding Due        : ₹${st.amount}
Account Status                 : ${st.amount <= 0 ? 'PAID IN FULL (NO DUES)' : 'PENDING OUTSTANDING'}
========================================
Thank you for your fee payment!`;

    document.getElementById('receipt-preview-box').innerText = generatedReceiptText;
    document.getElementById('receiptModal').style.display = 'flex';
}

function closeReceiptModal() {
    document.getElementById('receiptModal').style.display = 'none';
}

async function copyReceiptToClipboard() {
    if (!generatedReceiptText) return;
    try {
        await navigator.clipboard.writeText(generatedReceiptText);
        alert("Receipt copied to clipboard!");
    } catch {
        const t = document.createElement("textarea");
        t.value = generatedReceiptText;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
        alert("Receipt copied to clipboard!");
    }
}

// --- ADMIN MANAGEMENT PANEL ---
function populateAdminStudentDropdown() {
    const select = document.getElementById('adminStudentSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Choose Student --</option>';

    allStudentsList.forEach((st, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.innerText = `${st.name} [ID: ${st.studentId}] (${st.class})`;
        select.appendChild(opt);
    });
}

function loadStudentToAdminEditor() {
    const idx = document.getElementById('adminStudentSelect').value;
    const card = document.getElementById('adminEditorCard');

    if (idx === "") {
        card.style.display = 'none';
        return;
    }

    const st = allStudentsList[idx];
    document.getElementById('admin-editor-title').innerText = `Editing: ${st.name}`;
    document.getElementById('admin-view-id').innerText = st.studentId || `LG2026-${st.id.slice(0, 3).toUpperCase()}`;
    document.getElementById('admin-view-pass').innerText = st.password || String(st.phone || '').slice(-10);
    document.getElementById('admin-phone').value = st.phone === "No Phone" ? "" : st.phone;
    document.getElementById('admin-class').value = st.class;
    document.getElementById('admin-monthly-fee').value = st.monthlyFee;
    document.getElementById('admin-due-amt').value = st.amount;
    document.getElementById('admin-paid-amt').value = st.totalPaid;

    card.style.display = 'block';
    fetchPaymentHistory(st.id, 'admin-history-timeline', st);
}

async function saveAdminStudentUpdates() {
    const idx = document.getElementById('adminStudentSelect').value;
    if (idx === "") return;
    const st = allStudentsList[idx];

    const phone = document.getElementById('admin-phone').value.trim();
    const stClass = document.getElementById('admin-class').value.trim();
    const monthlyFee = Number(document.getElementById('admin-monthly-fee').value);
    const due = Number(document.getElementById('admin-due-amt').value);
    const totalPaid = Number(document.getElementById('admin-paid-amt').value);

    await db.collection("students").doc(st.id).update({
        phone: phone || "0000000000",
        class: stClass || "Unassigned",
        monthlyFee: monthlyFee,
        amount: due,
        totalPaid: totalPaid,
        isPaid: (due <= 0)
    });

    alert("Student profile updated!");
    await loadAllData();
    showPage('admin');
}

async function deleteStudentAdmin() {
    const idx = document.getElementById('adminStudentSelect').value;
    if (idx === "") return;
    const st = allStudentsList[idx];

    if (!confirm(`Are you sure you want to permanently delete ${st.name}?`)) return;

    const snap = await db.collection("students").doc(st.id).collection("paymentHistory").get();
    const batch = db.batch();
    snap.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection("students").doc(st.id));
    await batch.commit();

    alert("Student record removed.");
    document.getElementById('adminEditorCard').style.display = 'none';
    await loadAllData();
    showPage('admin');
}

// --- ADMISSION LEADS MANAGEMENT ---
async function loadAdmissionEnquiries() {
    const tbody = document.getElementById('enquiryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Fetching new enquiries...</td></tr>';

    try {
        const snap = await db.collection("admissionEnquiries").orderBy("createdAt", "desc").get();
        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim);">No pending admission enquiries.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        snap.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><b>${data.childName || 'Child'}</b><br><small style="color:var(--text-dim)">Parent: ${data.parentName || 'Parent'}</small></td>
                <td><a href="tel:${data.phone}" style="color:var(--primary); text-decoration:none;">📞 ${data.phone}</a></td>
                <td><span class="status-pill-ui paid">${data.grade}</span></td>
                <td><small style="color:var(--text-muted);">${data.message || 'No notes'}</small></td>
                <td>
                    <button class="btn-repair" style="border-color:var(--accent); color:var(--accent);" onclick="enrollEnquiryAsStudent('${doc.id}', '${encodeURIComponent(JSON.stringify(data))}')">Enroll</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444;">Failed to load: ${err.message}</td></tr>`;
    }
}

async function enrollEnquiryAsStudent(enquiryId, encodedData) {
    const data = JSON.parse(decodeURIComponent(encodedData));
    const feeStr = prompt(`Set Monthly Fee for enrolling ${data.childName} (${data.grade}):`, "1500");
    if (feeStr === null) return;
    const fee = Number(feeStr) || 0;

    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const generatedId = `LG2026-${randomSuffix}`;
    const defaultPassword = data.phone ? data.phone.slice(-10) : "123456";

    try {
        await db.collection("students").add({
            studentId: generatedId,
            password: defaultPassword,
            name: data.childName.toUpperCase(),
            phone: data.phone || "0000000000",
            class: data.grade,
            monthlyFee: fee,
            amount: fee,
            totalPaid: 0,
            lastPaidAmt: 0,
            lastPaymentDate: "-",
            isPaid: fee <= 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await db.collection("admissionEnquiries").doc(enquiryId).delete();
        alert(`🎉 ${data.childName} enrolled!\nStudent ID: ${generatedId}\nPassword: ${defaultPassword}`);
        loadAdmissionEnquiries();
        loadAllData();
    } catch (err) {
        alert("Enrollment failed: " + err.message);
    }
}

// --- BATCH MONTHLY BILLING ---
function openBillingModal() {
    document.getElementById('billingCustomFee').value = '';
    document.getElementById('billingModal').style.display = 'flex';
}

function closeBillingModal() {
    document.getElementById('billingModal').style.display = 'none';
}

async function executeMonthlyBilling() {
    const targetClass = document.getElementById('billingClassTarget').value;
    const customFee = Number(document.getElementById('billingCustomFee').value.trim());
    const isCustom = !isNaN(customFee) && customFee > 0;

    if (!targetClass) {
        alert("Please select a target class.");
        return;
    }

    if (!confirm(`Apply ${isCustom ? `₹${customFee}` : "assigned tuition fees"} to class: ${targetClass}?`)) return;

    try {
        let query = db.collection("students");
        if (targetClass !== "ALL") {
            query = query.where("class", "==", targetClass);
        }

        const snap = await query.get();
        const batch = db.batch();
        let count = 0;

        snap.forEach(doc => {
            const s = doc.data();
            const feeToAdd = isCustom ? customFee : (s.monthlyFee || 0);
            batch.update(doc.ref, {
                amount: (s.amount || 0) + feeToAdd,
                isPaid: false
            });
            count++;
        });

        await batch.commit();
        alert(`Successfully billed ${count} students!`);
        closeBillingModal();
        loadAllData();
    } catch (err) {
        alert("Error applying fees: " + err.message);
    }
}

// --- EXPORT TO SHEETS ---
async function exportStudentsToCSV() {
    try {
        const snap = await db.collection("students").orderBy("class", "asc").get();
        const rows = [["Student ID", "Class", "Student Name", "Phone", "Monthly Fee (INR)", "Due Amount (INR)", "Total Paid (INR)", "Status"].join(",")];

        snap.forEach(doc => {
            const s = doc.data() || {};
            rows.push([
                `"${s.studentId || ''}"`,
                `"${s.class || 'Unassigned'}"`,
                `"${(s.name || '').replace(/"/g, '""')}"`,
                `"${s.phone || ''}"`,
                s.monthlyFee || 0,
                s.amount || 0,
                s.totalPaid || 0,
                `"${(s.amount <= 0) ? 'PAID' : 'DUE'}"`
            ].join(","));
        });

        const blob = new Blob([rows.join("\n")], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Little_Garden_Report_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        alert("Export failed: " + err.message);
    }
}

// --- INVOICES (WHATSAPP & SMS) ---
function sendInvoice(channel) {
    if (!currentStudentData) return;
    const s = currentStudentData;
    const rawPhone = (s.phone || "").toString().replace(/[^0-9]/g, '');

    if (!rawPhone || rawPhone === "0000000000" || rawPhone.length < 10) {
        alert("Invalid phone number found for this student.");
        return;
    }

    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const invRef = 'INV-' + Math.floor(100000 + Math.random() * 900000);
    const formattedPhone = rawPhone.length === 10 ? '91' + rawPhone : rawPhone;
    const isCleared = Number(s.amount || 0) <= 0;

    if (channel === 'whatsapp') {
        const waMsg = 
`🏫 *LITTLE GARDEN SCHOOL*
📍 *Official Fee Invoice & Summary*
━━━━━━━━━━━━━━━━━━━━━
📋 *Invoice Ref :* ${invRef}
📅 *Date Issued :* ${today}

👤 *STUDENT DETAILS*
• *Name       :* *${s.name}*
• *Student ID :* *${s.studentId || 'LG2026-N/A'}*
• *Class      :* ${s.class || 'Unassigned'}
• *Phone      :* +${formattedPhone}

🔑 *PARENT PORTAL ACCESS*
• *Student ID :* *${s.studentId || 'LG2026-N/A'}*
• *Password   :* *${s.password || rawPhone.slice(-10)}*

💵 *ACCOUNT SUMMARY*
\`\`\`
------------------------------
Monthly Tuition Fee : ₹${Number(s.monthlyFee || 0).toLocaleString('en-IN')}
Total Fees Paid     : ₹${Number(s.totalPaid || 0).toLocaleString('en-IN')}
------------------------------
TOTAL BALANCE DUE   : ₹${Number(s.amount || 0).toLocaleString('en-IN')}
------------------------------
\`\`\`
📌 *Status :* ${isCleared ? "🟢 PAID IN FULL" : "🔴 PAYMENT PENDING"}

━━━━━━━━━━━━━━━━━━━━━
${isCleared 
  ? `✨ _All dues are cleared. Thank you for your timely payment!_` 
  : `⚠️ _Please settle the outstanding balance of *₹${Number(s.amount || 0).toLocaleString('en-IN')}* online via Parent Portal or at school office._`}

_For queries, please contact the school admin office._`;

        window.open("https://wa.me/" + formattedPhone + "?text=" + encodeURIComponent(waMsg), "_blank");
    } else {
        const smsMsg = 
`[LITTLE GARDEN SCHOOL]
Fee Invoice Ref: ${invRef}
Date: ${today}
Student: ${s.name} (ID: ${s.studentId || 'N/A'}, Class: ${s.class})
Portal Pass: ${s.password || rawPhone.slice(-10)}
Monthly Fee: Rs. ${s.monthlyFee}
Total Paid: Rs. ${s.totalPaid || 0}
Outstanding Balance: Rs. ${s.amount}
Status: ${isCleared ? 'PAID' : 'PENDING'}`;

        window.location.href = "sms:" + formattedPhone + "?body=" + encodeURIComponent(smsMsg);
    }
}
