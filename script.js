// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCFv0Pmc8a684gCO7e96pZF2dEma0Basr4",
    authDomain: "littlegardenplayschool.vercel.app",
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
let editingStudentDocId = null;

// --- MONTHLY BILLING & LEDGER HELPERS ---
// Generates months starting only from the student's admission date up to the current month
function getMonthListForStudent(admissionMonthKey) {
    const months = [];
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1; // 1-12

    let startYear = curYear;
    let startMonth = curMonth;

    if (admissionMonthKey && typeof admissionMonthKey === 'string' && admissionMonthKey.includes('-')) {
        const parts = admissionMonthKey.split('-');
        startYear = parseInt(parts[0], 10);
        startMonth = parseInt(parts[1], 10);
    }

    let y = startYear;
    let m = startMonth;

    while (y < curYear || (y === curYear && m <= curMonth)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const label = new Date(y, m - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        months.push({ key, label });
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }
    return months;
}

async function autoSyncMonthlyBillingForStudents(studentsSnap) {
    const batch = db.batch();
    let hasUpdates = false;

    studentsSnap.forEach(doc => {
        const s = doc.data() || {};
        if (s.class === "Graduated") return;

        const tuitionFee = Number(s.monthlyFee || 0);
        const transportFee = s.hasTransport ? Number(s.transportFee || 0) : 0;
        const totalMonthly = tuitionFee + transportFee;
        if (totalMonthly <= 0) return;

        let ledger = s.monthlyLedger || {};
        const existingKeys = Object.keys(ledger).sort();

        // Determine student's start month: use admissionMonth or the earliest recorded month
        const now = new Date();
        const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const startMonthKey = s.admissionMonth || (existingKeys.length > 0 ? existingKeys[0] : currentKey);

        const requiredMonths = getMonthListForStudent(startMonthKey);
        let addedDue = 0;
        let modified = false;

        requiredMonths.forEach(m => {
            if (!ledger[m.key]) {
                ledger[m.key] = {
                    monthName: m.label,
                    billed: totalMonthly,
                    paid: 0,
                    status: "UNPAID",
                    tuitionFee: tuitionFee,
                    transportFee: transportFee
                };
                addedDue += totalMonthly;
                modified = true;
            }
        });

        if (modified) {
            hasUpdates = true;
            const newTotalDue = (Number(s.amount) || 0) + addedDue;
            batch.update(doc.ref, {
                monthlyLedger: ledger,
                amount: newTotalDue,
                isPaid: (newTotalDue <= 0)
            });
        }
    });

    if (hasUpdates) {
        await batch.commit();
    }
}

function allocatePaymentToMonths(ledger, payAmt) {
    let remainingPayment = payAmt;
    const sortedKeys = Object.keys(ledger || {}).sort();

    sortedKeys.forEach(mKey => {
        if (remainingPayment <= 0) return;
        const entry = ledger[mKey];
        const monthDue = (entry.billed || 0) - (entry.paid || 0);

        if (monthDue > 0) {
            const settle = Math.min(remainingPayment, monthDue);
            entry.paid = (entry.paid || 0) + settle;
            remainingPayment -= settle;

            if (entry.paid >= entry.billed) {
                entry.status = "PAID";
            } else if (entry.paid > 0) {
                entry.status = "PARTIAL";
            }
        }
    });

    return ledger;
}

function renderMonthGridUI(ledger, containerElement) {
    if (!containerElement) return;
    const keys = Object.keys(ledger || {}).sort();
    if (keys.length === 0) {
        containerElement.innerHTML = '<small style="color:var(--text-dim)">No billing history logged yet.</small>';
        return;
    }

    let html = '<div style="display:flex; flex-wrap:wrap; gap:8px; margin: 10px 0;">';
    keys.forEach(k => {
        const item = ledger[k];
        const due = (item.billed || 0) - (item.paid || 0);
        let color = '#34d399';
        let bg = 'rgba(16, 185, 129, 0.15)';
        let border = 'rgba(16, 185, 129, 0.35)';
        let statusText = `✓ Paid (₹${item.paid})`;

        if (item.status === 'UNPAID') {
            color = '#f87171';
            bg = 'rgba(239, 68, 68, 0.15)';
            border = 'rgba(239, 68, 68, 0.35)';
            statusText = `Due: ₹${due}`;
        } else if (item.status === 'PARTIAL') {
            color = '#facc15';
            bg = 'rgba(234, 179, 8, 0.15)';
            border = 'rgba(234, 179, 8, 0.35)';
            statusText = `Paid ₹${item.paid} / Due ₹${due}`;
        }

        html += `
            <div style="background:${bg}; border:1px solid ${border}; border-radius:6px; padding:6px 10px; font-size:0.75rem;">
                <b style="color:#ffffff; display:block;">${item.monthName || k}</b>
                <span style="color:${color}; font-weight:700;">${statusText}</span>
            </div>
        `;
    });
    html += '</div>';
    containerElement.innerHTML = html;
}

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
        errText.innerText = "Login failed: check your credentials or network connection.";
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
        loadPendingPayments();
    }
}

// --- LOAD ALL STUDENTS ---
async function loadAllData() {
    const tbody = document.getElementById('studentData');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading Finance Data...</td></tr>';

    try {
        const snap = await db.collection("students").orderBy("name", "asc").get();
        await autoSyncMonthlyBillingForStudents(snap);

        const updatedSnap = await db.collection("students").orderBy("name", "asc").get();
        allStudentsList = [];
        let totalCount = 0;
        let totalDues = 0;

        updatedSnap.forEach(doc => {
            const s = doc.data() || {};
            totalCount++;
            const dueAmt = Number(s.amount || 0);
            totalDues += dueAmt;

            allStudentsList.push({
                id: doc.id,
                studentId: s.studentId || `LG2026-${doc.id.slice(0, 3).toUpperCase()}`,
                password: s.password || String(s.phone || '').slice(-10),
                name: s.name || 'Unnamed Student',
                parentEmail: s.parentEmail || '',
                class: s.class || 'Unassigned',
                phone: s.phone || 'No Phone',
                monthlyFee: Number(s.monthlyFee || 0),
                hasTransport: s.hasTransport || false,
                transportFee: Number(s.transportFee || 0),
                monthlyLedger: s.monthlyLedger || {},
                amount: dueAmt,
                totalPaid: Number(s.totalPaid || 0),
                isPaid: s.isPaid ?? (dueAmt <= 0),
                lastPaidAmt: Number(s.lastPaidAmt || 0),
                lastPaymentDate: s.lastPaymentDate || '-'
            });
        });

        document.getElementById('stat-count').innerText = totalCount;
        document.getElementById('stat-dues').innerText = `₹${totalDues.toLocaleString('en-IN')}`;
        renderStudentTable(allStudentsList);
        populateAdminStudentDropdown();
    } catch (err) {
        console.error("Error loading data:", err);
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
                ${s.parentEmail ? `<br><small style="color:var(--text-muted); font-size:11px;">✉️ ${s.parentEmail}</small>` : ''}
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

// --- 1. STUDENT REGISTRATION ---
async function addStudentToFirebase(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('studentName').value.trim();
    const phone = document.getElementById('parentPhone').value.trim();
    const stClass = document.getElementById('studentClass').value;
    const tuitionFee = Number(document.getElementById('feeAmount').value || 0);

    const emailInput = document.getElementById('parentEmail');
    const parentEmail = emailInput ? emailInput.value.toLowerCase().trim() : '';

    const hasTransport = document.getElementById('transportOptCheck') ? document.getElementById('transportOptCheck').checked : false;
    const transportFeeInput = document.getElementById('studentTransportFee');
    const transportFee = (hasTransport && transportFeeInput) ? Number(transportFeeInput.value || 0) : 0;
    const initialDue = tuitionFee + transportFee;

    if (!name) {
        alert("Student Name is required!");
        return;
    }

    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const generatedId = `LG2026-${randomSuffix}`;
    const defaultPassword = phone ? phone.slice(-10) : "123456";

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthLabel = now.toLocaleString('en-IN', { month: 'short', year: 'numeric' });

    const initialMonthlyLedger = {};
    if (initialDue > 0) {
        initialMonthlyLedger[currentMonthKey] = {
            monthName: currentMonthLabel,
            billed: initialDue,
            paid: 0,
            status: "UNPAID",
            tuitionFee: tuitionFee,
            transportFee: transportFee
        };
    }

    try {
        await db.collection("students").add({
            studentId: generatedId,
            password: defaultPassword,
            name: name.toUpperCase(),
            phone: phone || "0000000000",
            parentEmail: parentEmail,
            class: stClass,
            monthlyFee: tuitionFee,
            hasTransport: hasTransport,
            transportFee: transportFee,
            admissionMonth: currentMonthKey, // e.g. "2026-08"
            monthlyLedger: initialMonthlyLedger,
            amount: initialDue,
            totalPaid: 0,
            lastPaidAmt: 0,
            lastPaymentDate: "-",
            isPaid: initialDue <= 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`✅ Student Registered Successfully!\n\nID: ${generatedId}\nEmail: ${parentEmail || 'Not Linked'}\nPassword: ${defaultPassword}\nTuition Fee: ₹${tuitionFee}\nTransport Fee: ₹${transportFee}\nInitial Billed Month: ${currentMonthLabel}\nTotal Opening Due: ₹${initialDue}`);
        document.getElementById('addStudentForm').reset();
        const transportBox = document.getElementById('transportFeeInputBox');
        if (transportBox) transportBox.style.display = 'none';
        showPage('dashboard');
        loadAllData();
    } catch (err) {
        alert("Registration failed: " + err.message);
    }
}

// --- 2. ENROLL FROM ADMISSION LEADS ---
async function enrollEnquiryAsStudent(enquiryId, encodedData) {
    const data = JSON.parse(decodeURIComponent(encodedData));
    const child = data.childName || data.name || 'Student';
    const grade = data.grade || data.class || 'Nursery';
    
    const feeStr = prompt(`Step 1/3: Enter Base Monthly Tuition Fee for ${child} (${grade}):`, "1500");
    if (feeStr === null) return;
    const tuitionFee = Number(feeStr) || 0;

    const needsTransport = confirm(`Step 2/3: Does ${child} require School Bus / Transport Service?`);
    let transportFee = 0;
    if (needsTransport) {
        const transStr = prompt(`Enter Monthly Transport Fee for ${child}:`, "800");
        transportFee = Number(transStr) || 0;
    }

    const parentEmailInput = prompt(`Step 3/3: (Optional) Enter Guardian Google Email for portal sign-in:`, "");
    const parentEmail = parentEmailInput ? parentEmailInput.toLowerCase().trim() : "";

    const totalInitialDue = tuitionFee + transportFee;
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const generatedId = `LG2026-${randomSuffix}`;
    const defaultPassword = data.phone ? String(data.phone).slice(-10) : "123456";

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthLabel = now.toLocaleString('en-IN', { month: 'short', year: 'numeric' });

    const initialMonthlyLedger = {};
    if (totalInitialDue > 0) {
        initialMonthlyLedger[currentMonthKey] = {
            monthName: currentMonthLabel,
            billed: totalInitialDue,
            paid: 0,
            status: "UNPAID",
            tuitionFee: tuitionFee,
            transportFee: transportFee
        };
    }

    try {
        await db.collection("students").add({
            studentId: generatedId,
            password: defaultPassword,
            name: child.toUpperCase(),
            phone: data.phone || "0000000000",
            parentEmail: parentEmail,
            class: grade,
            monthlyFee: tuitionFee,
            hasTransport: needsTransport,
            transportFee: transportFee,
            monthlyLedger: initialMonthlyLedger,
            amount: totalInitialDue,
            totalPaid: 0,
            lastPaidAmt: 0,
            lastPaymentDate: "-",
            isPaid: totalInitialDue <= 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await db.collection("admissionEnquiries").doc(enquiryId).delete().catch(() => {});
        await db.collection("admissions").doc(enquiryId).delete().catch(() => {});

        alert(`🎉 ${child} Enrolled!\nStudent ID: ${generatedId}\nEmail: ${parentEmail || 'Not Linked'}\nTuition: ₹${tuitionFee} | Transport: ₹${transportFee}\nOpening Due: ₹${totalInitialDue}`);
        loadAdmissionEnquiries();
        loadAllData();
    } catch (err) {
        alert("Enrollment failed: " + err.message);
    }
}

// --- 3. BATCH MONTHLY TRANSPORT FEE BILLING ---
async function executeMonthlyTransportBilling() {
    const targetClass = document.getElementById('billingClassTarget').value;
    
    if (!confirm(`Apply monthly transport fees to all enrolled transport students in: ${targetClass}?`)) return;

    try {
        let query = db.collection("students").where("hasTransport", "==", true);
        if (targetClass !== "ALL") {
            query = query.where("class", "==", targetClass);
        }

        const snap = await query.get();
        if (snap.empty) {
            alert("No students with active transport service found in this class selection.");
            return;
        }

        const batch = db.batch();
        let count = 0;
        const nowStr = new Date().toLocaleString('en-IN');

        snap.forEach(doc => {
            const s = doc.data();
            const tFee = Number(s.transportFee || 0);
            if (tFee > 0) {
                const newDue = (s.amount || 0) + tFee;
                batch.update(doc.ref, {
                    amount: newDue,
                    isPaid: false
                });

                const histRef = doc.ref.collection("paymentHistory").doc();
                batch.set(histRef, {
                    amount: tFee,
                    type: "adjustment",
                    method: "System",
                    note: `Monthly Transport Fee Added (₹${tFee})`,
                    remainingDue: newDue,
                    date: nowStr,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;
            }
        });

        await batch.commit();
        alert(`🚌 Successfully billed transport fee for ${count} students!`);
        closeBillingModal();
        loadAllData();
    } catch (err) {
        alert("Error applying transport fees: " + err.message);
    }
}

// --- SEARCH & FILTER ---
function filterStudents() {
    const searchVal = document.getElementById('studentSearch').value.toLowerCase().trim();
    const classVal = document.getElementById('classFilter').value;

    // Filter students from the dataset matching search text and class selection
    const filteredStudents = allStudentsList.filter(s => {
        const matchSearch = !searchVal || 
            s.name.toLowerCase().includes(searchVal) || 
            s.studentId.toLowerCase().includes(searchVal) || 
            String(s.phone).includes(searchVal);

        const matchClass = (classVal === 'ALL') || (s.class === classVal);

        return matchSearch && matchClass;
    });

    // Recalculate totals for the filtered class view
    const filteredCount = filteredStudents.length;
    const filteredDues = filteredStudents.reduce((sum, s) => sum + Number(s.amount || 0), 0);

    // Update the Dashboard statistic cards dynamically
    document.getElementById('stat-count').innerText = filteredCount;
    document.getElementById('stat-dues').innerText = `₹${filteredDues.toLocaleString('en-IN')}`;

    // Render only the filtered students in the table
    renderStudentTable(filteredStudents);
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

    const monthContainer = document.getElementById('admin-modal-month-grid');
    if (monthContainer) {
        renderMonthGridUI(currentStudentData.monthlyLedger, monthContainer);
    }

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

    const updatedLedger = allocatePaymentToMonths(currentStudentData.monthlyLedger || {}, payAmt);
    const docRef = db.collection("students").doc(currentStudentId);

    await docRef.update({
        amount: newDue,
        totalPaid: newTotalPaid,
        lastPaidAmt: payAmt,
        lastPaymentDate: nowStr,
        monthlyLedger: updatedLedger,
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
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN');
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthLabel = now.toLocaleString('en-IN', { month: 'short', year: 'numeric' });

    // Update the current month's entry in monthlyLedger
    const ledger = currentStudentData.monthlyLedger || {};
    if (!ledger[currentMonthKey]) {
        ledger[currentMonthKey] = {
            monthName: currentMonthLabel,
            billed: Number(currentStudentData.monthlyFee || 0) + (currentStudentData.hasTransport ? Number(currentStudentData.transportFee || 0) : 0),
            paid: 0,
            status: "UNPAID"
        };
    }

    const currentMonthEntry = ledger[currentMonthKey];
    if (type === 'add') {
        currentMonthEntry.billed = (currentMonthEntry.billed || 0) + amt;
    } else {
        currentMonthEntry.billed = Math.max(0, (currentMonthEntry.billed || 0) - amt);
    }

    const remainingMonthDue = (currentMonthEntry.billed || 0) - (currentMonthEntry.paid || 0);
    currentMonthEntry.status = remainingMonthDue <= 0 ? "PAID" : ((currentMonthEntry.paid || 0) > 0 ? "PARTIAL" : "UNPAID");

    const docRef = db.collection("students").doc(currentStudentId);

    await docRef.update({
        amount: newDue,
        monthlyLedger: ledger,
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

    alert("Fee adjustment recorded and added to monthly ledger!");
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
    const currentSelectedId = editingStudentDocId || select.value;
    select.innerHTML = '<option value="">-- Choose Student --</option>';

    allStudentsList.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.innerText = `${st.name} [ID: ${st.studentId}] (${st.class})`;
        select.appendChild(opt);
    });

    if (currentSelectedId) select.value = currentSelectedId;
}

function loadStudentToAdminEditor() {
    const select = document.getElementById('adminStudentSelect');
    const studentDocId = select.value;
    const card = document.getElementById('adminEditorCard');

    if (!studentDocId) {
        card.style.display = 'none';
        editingStudentDocId = null;
        return;
    }

    const st = allStudentsList.find(s => s.id === studentDocId);
    if (!st) {
        alert("Student data not found.");
        return;
    }

    editingStudentDocId = st.id;

    document.getElementById('admin-editor-title').innerText = `Editing: ${st.name}`;
    document.getElementById('admin-view-id').innerText = st.studentId || `LG2026-${st.id.slice(0, 3).toUpperCase()}`;
    document.getElementById('admin-view-pass').innerText = st.password || String(st.phone || '').slice(-10);
    
    const nameField = document.getElementById('admin-student-name');
    if (nameField) nameField.value = st.name || "";

    const emailField = document.getElementById('admin-parent-email');
    if (emailField) emailField.value = st.parentEmail || "";

    const phoneField = document.getElementById('admin-phone');
    if (phoneField) phoneField.value = st.phone === "No Phone" ? "" : st.phone;

    const classField = document.getElementById('admin-class');
    if (classField) classField.value = st.class || "";

    const feeField = document.getElementById('admin-monthly-fee');
    if (feeField) feeField.value = st.monthlyFee || 0;

    const dueField = document.getElementById('admin-due-amt');
    if (dueField) dueField.value = st.amount || 0;

    const paidField = document.getElementById('admin-paid-amt');
    if (paidField) paidField.value = st.totalPaid || 0;

    card.style.display = 'block';
    fetchPaymentHistory(st.id, 'admin-history-timeline', st);
}

async function saveAdminStudentUpdates() {
    if (!editingStudentDocId) {
        alert("Please select a student from the dropdown first.");
        return;
    }

    const nameField = document.getElementById('admin-student-name');
    const name = nameField ? nameField.value.trim().toUpperCase() : '';

    const phoneField = document.getElementById('admin-phone');
    const phone = phoneField ? phoneField.value.trim() : "0000000000";

    const emailField = document.getElementById('admin-parent-email');
    const parentEmail = emailField ? emailField.value.toLowerCase().trim() : '';

    const classField = document.getElementById('admin-class');
    const stClass = classField ? classField.value.trim() : "Unassigned";

    const feeField = document.getElementById('admin-monthly-fee');
    const monthlyFee = Number(feeField ? feeField.value : 0);

    const dueField = document.getElementById('admin-due-amt');
    const due = Number(dueField ? dueField.value : 0);

    const paidField = document.getElementById('admin-paid-amt');
    const totalPaid = Number(paidField ? paidField.value : 0);

    if (!name) {
        alert("Student Name cannot be empty.");
        return;
    }

    try {
        await db.collection("students").doc(editingStudentDocId).update({
            name: name,
            phone: phone || "0000000000",
            parentEmail: parentEmail,
            class: stClass || "Unassigned",
            monthlyFee: monthlyFee,
            amount: due,
            totalPaid: totalPaid,
            isPaid: (due <= 0)
        });

        alert("✓ Changes saved successfully to Firestore!");
        await loadAllData();
        
        const select = document.getElementById('adminStudentSelect');
        if (select) {
            select.value = editingStudentDocId;
            loadStudentToAdminEditor();
        }
    } catch (err) {
        console.error("Firestore update error:", err);
        alert("Failed to save changes: " + err.message);
    }
}

async function deleteStudentAdmin() {
    if (!editingStudentDocId) return;
    const st = allStudentsList.find(s => s.id === editingStudentDocId);
    if (!st) return;

    if (!confirm(`Are you sure you want to permanently delete ${st.name}?`)) return;

    try {
        const snap = await db.collection("students").doc(editingStudentDocId).collection("paymentHistory").get();
        const batch = db.batch();
        snap.forEach(d => batch.delete(d.ref));
        batch.delete(db.collection("students").doc(editingStudentDocId));
        await batch.commit();

        alert("Student record removed.");
        document.getElementById('adminEditorCard').style.display = 'none';
        editingStudentDocId = null;
        await loadAllData();
        showPage('admin');
    } catch (err) {
        alert("Error deleting student: " + err.message);
    }
}

// --- ADMISSION LEADS MANAGEMENT ---
async function loadAdmissionEnquiries() {
    const tbody = document.getElementById('enquiryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:16px;">Fetching new enquiries...</td></tr>';

    try {
        let snap = null;
        try {
            snap = await db.collection("admissionEnquiries").orderBy("createdAt", "desc").get();
        } catch (e) {
            snap = await db.collection("admissionEnquiries").get();
        }
        
        if (!snap || snap.empty) {
            try {
                snap = await db.collection("admissions").orderBy("timestamp", "desc").get();
            } catch (e) {
                snap = await db.collection("admissions").get();
            }
        }

        if (!snap || snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:24px; font-weight:600;">✨ There are no enquiries.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        snap.forEach(doc => {
            const data = doc.data() || {};
            const child = data.childName || data.name || 'Child';
            const parent = data.parentName || 'Parent';
            const phone = data.phone || 'No Phone';
            const grade = data.grade || data.class || 'N/A';
            const msg = data.notes || data.message || 'No notes';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td><b>${child}</b><br><small style="color:var(--text-dim)">Parent: ${parent}</small></td>
                <td><a href="tel:${phone}" style="color:var(--primary); text-decoration:none;">📞 ${phone}</a></td>
                <td><span class="status-pill-ui paid" style="font-size:0.7rem; padding:3px 8px;">${grade}</span></td>
                <td><small style="color:var(--text-muted);">${msg}</small></td>
                <td>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="status-pill-ui paid" style="padding:4px 12px; font-size:0.75rem;" onclick="enrollEnquiryAsStudent('${doc.id}', '${encodeURIComponent(JSON.stringify(data))}')">Enroll</button>
                        <button class="status-pill-ui pending" style="padding:4px 12px; font-size:0.75rem;" onclick="deleteAdmissionLead('${doc.id}', '${child.replace(/'/g, "\\'")}')">Delete</button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:24px; font-weight:600;">✨ There are no enquiries.</td></tr>';
    }
}

async function deleteAdmissionLead(docId, childName) {
    if (!confirm(`Are you sure you want to delete the enquiry for "${childName}"?`)) return;

    try {
        await db.collection("admissionEnquiries").doc(docId).delete().catch(() => {});
        await db.collection("admissions").doc(docId).delete().catch(() => {});
        alert(`✓ Enquiry for "${childName}" removed successfully.`);
        loadAdmissionEnquiries();
    } catch (err) {
        alert("Error deleting enquiry: " + err.message);
    }
}

// --- BATCH MONTHLY TUITION BILLING ---
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

// --- EXPORT TO CSV ---
async function exportStudentsToCSV() {
    try {
        const snap = await db.collection("students").orderBy("class", "asc").get();
        const rows = [["Student ID", "Class", "Student Name", "Phone", "Guardian Email", "Monthly Fee (INR)", "Due Amount (INR)", "Total Paid (INR)", "Status"].join(",")];

        snap.forEach(doc => {
            const s = doc.data() || {};
            rows.push([
                `"${s.studentId || ''}"`,
                `"${s.class || 'Unassigned'}"`,
                `"${(s.name || '').replace(/"/g, '""')}"`,
                `"${s.phone || ''}"`,
                `"${s.parentEmail || ''}"`,
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

// --- INVOICE DISPATCH ---
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

    const ledger = s.monthlyLedger || {};
    const unpaidMonths = Object.keys(ledger)
        .filter(k => ledger[k].status !== 'PAID')
        .map(k => `• ${ledger[k].monthName || k}: Due ₹${(ledger[k].billed || 0) - (ledger[k].paid || 0)}`)
        .join('\n');

    const monthSummaryText = unpaidMonths.length > 0 
        ? `\n📌 *PENDING MONTHS:*\n${unpaidMonths}\n` 
        : `\n✨ *All billed months are cleared!*\n`;

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
${s.parentEmail ? `• *Google ID  :* ${s.parentEmail}` : ''}

💵 *ACCOUNT SUMMARY*
\`\`\`
------------------------------
Monthly Tuition Fee : ₹${Number(s.monthlyFee || 0).toLocaleString('en-IN')}
Total Fees Paid     : ₹${Number(s.totalPaid || 0).toLocaleString('en-IN')}
------------------------------
TOTAL BALANCE DUE   : ₹${Number(s.amount || 0).toLocaleString('en-IN')}
------------------------------
\`\`\`${monthSummaryText}
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

// --- ANNUAL ACADEMIC ROLLOVER ---
async function executeAnnualSessionRollover() {
    const confirmRollover = confirm(
        "⚠️ ANNUAL ACADEMIC SESSION ROLLOVER\n\n" +
        "This will batch-advance all active students to the next academic grade:\n" +
        "• Playgroup → Nursery\n" +
        "• Nursery → LKG\n" +
        "• LKG → UKG\n" +
        "• UKG → Class 1\n" +
        "• Class 1 → Class 2\n" +
        "• Class 2 → Class 3\n" +
        "• Class 3 → Class 4\n" +
        "• Class 4 → Class 5\n" +
        "• Class 5 → Graduated (Alumni)\n\n" +
        "Are you sure you want to advance all students to the next academic year?"
    );

    if (!confirmRollover) return;

    const classProgression = {
        "Playgroup": "Nursery",
        "Nursery": "LKG",
        "LKG": "UKG",
        "UKG": "Class 1",
        "Class 1": "Class 2",
        "Class 2": "Class 3",
        "Class 3": "Class 4",
        "Class 4": "Class 5",
        "Class 5": "Graduated"
    };

    try {
        const snap = await db.collection("students").get();
        if (snap.empty) {
            alert("No student records found to advance.");
            return;
        }

        const batch = db.batch();
        let promotedCount = 0;
        let graduatedCount = 0;

        snap.forEach(doc => {
            const data = doc.data() || {};
            const currentClass = data.class;

            if (classProgression[currentClass]) {
                const nextClass = classProgression[currentClass];
                
                batch.update(doc.ref, {
                    class: nextClass,
                    previousClass: currentClass,
                    promotedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                if (nextClass === "Graduated") {
                    graduatedCount++;
                } else {
                    promotedCount++;
                }
            }
        });

        await batch.commit();

        alert(
            `🎉 Academic Progression Completed Successfully!\n\n` +
            `• Students Advanced: ${promotedCount}\n` +
            `• Students Graduated (Class 5): ${graduatedCount}`
        );

        await loadAllData();
        showPage('admin');
    } catch (err) {
        console.error("Session rollover error:", err);
        alert("Error during session transition: " + err.message);
    }
}

// --- LOAD PENDING UPI PAYMENT CLAIMS ---
async function loadPendingPayments() {
    const tbody = document.getElementById('pendingPaymentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:16px;">Checking pending payments...</td></tr>';

    try {
        const snap = await db.collection("pendingPayments").where("status", "==", "PENDING").get();

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:24px; font-weight:600;">✨ No pending UPI payments to verify.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        snap.forEach(doc => {
            const p = doc.data() || {};
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><b>${p.studentName}</b> <small style="color:var(--primary)">[${p.class}]</small><br><small style="color:var(--text-dim)">ID: ${p.studentId} | 📞 ${p.phone}</small></td>
                <td style="color:#34d399; font-weight:800; font-size:1.05rem;">₹${Number(p.amount || 0).toLocaleString('en-IN')}</td>
                <td><code style="background:rgba(255,255,255,0.08); padding:4px 8px; border-radius:4px; font-size:0.85rem; color:#facc15;">${p.utrNumber}</code></td>
                <td><small style="color:var(--text-dim)">${p.submittedAtStr || '-'}</small></td>
                <td>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="status-pill-ui paid" style="padding:4px 12px; font-size:0.75rem;" onclick="approvePaymentClaim('${doc.id}', '${p.studentDocId}', ${p.amount}, '${p.utrNumber}')">✓ Approve & Settle</button>
                        <button class="status-pill-ui pending" style="padding:4px 12px; font-size:0.75rem;" onclick="rejectPaymentClaim('${doc.id}', '${p.studentName.replace(/'/g, "\\'")}', '${p.utrNumber}')">✗ Reject</button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:18px;">Error: ${err.message}</td></tr>`;
    }
}

// --- APPROVE AND SETTLE BALANCE ---
async function approvePaymentClaim(claimId, studentDocId, amt, utr) {
    if (!confirm(`Confirm you received ₹${amt} in the school bank account with UTR: ${utr}?`)) return;

    try {
        const studentRef = db.collection("students").doc(studentDocId);
        const studentDoc = await studentRef.get();

        if (!studentDoc.exists) {
            alert("Student record not found.");
            return;
        }

        const student = studentDoc.data();
        const currentDue = Number(student.amount || 0);
        const newDue = Math.max(0, currentDue - amt);
        const newTotalPaid = Number(student.totalPaid || 0) + amt;
        const nowStr = new Date().toLocaleString('en-IN');

        const updatedLedger = allocatePaymentToMonths(student.monthlyLedger || {}, amt);
        const batch = db.batch();

        batch.update(studentRef, {
            amount: newDue,
            totalPaid: newTotalPaid,
            lastPaidAmt: amt,
            lastPaymentDate: nowStr,
            monthlyLedger: updatedLedger,
            isPaid: (newDue <= 0)
        });

        const histRef = studentRef.collection("paymentHistory").doc();
        batch.set(histRef, {
            amount: amt,
            type: "payment",
            method: "UPI Direct (Verified)",
            note: `UPI UTR Ref: ${utr}`,
            remainingDue: newDue,
            date: nowStr,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        batch.delete(db.collection("pendingPayments").doc(claimId));

        await batch.commit();

        alert(`🎉 Payment of ₹${amt} verified and applied to ${student.name}'s balance!`);
        loadPendingPayments();
        loadAllData();
    } catch (err) {
        alert("Error approving payment: " + err.message);
    }
}

// --- REJECT PAYMENT CLAIM ---
async function rejectPaymentClaim(claimId, studentName, utr) {
    const reason = prompt(`Reason for rejecting payment claim (UTR: ${utr}) for ${studentName}:`, "UTR not found in school bank statement");
    if (reason === null) return;

    try {
        await db.collection("pendingPayments").doc(claimId).delete();
        alert(`Payment claim rejected and removed.`);
        loadPendingPayments();
    } catch (err) {
        alert("Error rejecting claim: " + err.message);
    }
}
