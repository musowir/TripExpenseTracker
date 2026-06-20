let globalCachedData = { expenses: [], categories: [] };
let globalTripsList = [];
let globalPeopleList = [];
let currentTripId = parseInt(localStorage.getItem('activeTripId')) || 1;

function setDefaultDateTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('expDateTime').value = now.toISOString().slice(0, 16);
}

window.addEventListener('DOMContentLoaded', () => {
    initAppEngine();
    setDefaultDateTime();
    pullTripsList(true);
});

function initAppEngine() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            const targetId = this.getAttribute('data-target');
            if(document.getElementById(targetId)) document.getElementById(targetId).classList.add('active');
            
            const headerTitle = document.querySelector('header h1');
            if(headerTitle) {
                if(targetId === 'view-home') headerTitle.textContent = "Log";
                if(targetId === 'view-history') headerTitle.textContent = "Logs";
                if(targetId === 'view-analytics') headerTitle.textContent = "Metrics";
                if(targetId === 'view-settings') headerTitle.textContent = "Setup";
            }
        });
    });

    document.getElementById('globalTripSelector').addEventListener('change', function() {
        currentTripId = parseInt(this.value);
        localStorage.setItem('activeTripId', currentTripId);
        pullDatabaseState();
    });

    document.getElementById('expCategory').addEventListener('change', function() {
        populateSubDropdown(this.value);
    });

    document.getElementById('addTripBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTripInput');
        const name = input.value.trim();
        if(!name) return;
        
        try {
            const response = await fetch('/api/trips/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const resData = await response.json();
            if(response.ok) {
                input.value = '';
                currentTripId = resData.id;
                localStorage.setItem('activeTripId', currentTripId);
                await pullTripsList(true);
            } else { alert(resData.error || "Failed to create trip."); }
        } catch { alert("Network error saving trip."); }
    });

    document.getElementById('addPersonBtn').addEventListener('click', async () => {
        const input = document.getElementById('newPersonInput');
        const name = input.value.trim();
        if(!name) return;
        if(name.toLowerCase() === 'me') {
            alert("'me' is protected and always initialized by default.");
            return;
        }

        try {
            const response = await fetch('/api/people/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trip_id: currentTripId, name })
            });
            if(response.ok) {
                input.value = '';
                await pullPeopleList();
            } else {
                const resData = await response.json();
                alert(resData.error || "Failed to append roster name.");
            }
        } catch { alert("Network infrastructure connection error."); }
    });

    document.getElementById('pdfBtn').addEventListener('click', () => {
        const now = new Date();
        const activeTripName = document.getElementById('globalTripSelector').options[document.getElementById('globalTripSelector').selectedIndex]?.text || 'Trip';
        
        document.getElementById('printReportTitle').textContent = `${activeTripName} - Split Balance Report`;
        document.getElementById('printGenerationDate').textContent = `Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        
        const targetElement = document.getElementById('printReportContainer');
        targetElement.style.display = 'block';

        const configOptions = {
            margin:       10,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { 
                scale: 2, 
                useCORS: true, 
                logging: false,
                scrollX: 0,
                scrollY: 0
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(configOptions).from(targetElement).outputPdf('blob').then((pdfBlob) => {
            targetElement.style.display = 'none';
            const blobUrl = URL.createObjectURL(pdfBlob);
            const downloadLink = document.createElement('a');
            downloadLink.href = blobUrl;
            downloadLink.download = `${activeTripName.replace(/\s+/g, '_')}_DetailedSplitReport.pdf`; 
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(blobUrl);
        }).catch(() => { targetElement.style.display = 'none'; });
    });

    document.getElementById('exportBtn').addEventListener('click', exportDataSnapshot);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllDatabaseLogs);
}

async function pullTripsList(shouldInitialLoadState = false) {
    try {
        const response = await fetch('/api/trips');
        if(!response.ok) throw new Error();
        globalTripsList = await response.json();
        
        if(globalTripsList.length > 0 && !globalTripsList.some(t => t.id === currentTripId)) {
            currentTripId = globalTripsList[0].id;
            localStorage.setItem('activeTripId', currentTripId);
        }
        
        renderTripSelectors();
        if(shouldInitialLoadState) await pullDatabaseState();
    } catch { updateSyncBadge('error', 'DB Offline'); }
}

async function pullPeopleList() {
    try {
        const response = await fetch(`/api/people?trip_id=${currentTripId}`);
        if(!response.ok) throw new Error();
        globalPeopleList = await response.json();
        
        if(!globalPeopleList.some(p => p.name === 'me')) {
            globalPeopleList.unshift({ id: 0, name: 'me' });
        }
        
        renderPeopleSelectors();
    } catch { updateSyncBadge('error', 'DB Offline'); }
}

function renderTripSelectors() {
    const headerSel = document.getElementById('globalTripSelector');
    const settingsList = document.getElementById('settingsTripManagementList');
    if(!headerSel || !settingsList) return;

    headerSel.innerHTML = '';
    settingsList.innerHTML = '';

    globalTripsList.forEach(trip => {
        const option = document.createElement('option');
        option.value = trip.id; option.textContent = trip.name;
        if(trip.id === currentTripId) option.selected = true;
        headerSel.appendChild(option);

        const row = document.createElement('div');
        row.className = 'list-item-row';
        row.innerHTML = `
            <span style="font-size:13px; font-weight: ${trip.id === currentTripId ? '700':'400'}; color: ${trip.id === currentTripId ? 'var(--accent-glow)':'var(--text-pure)'}">
                ${escapeHtml(trip.name)} ${trip.id === currentTripId ? '(Active)':''}
            </span>
            ${globalTripsList.length > 1 ? `<span style="color:var(--danger-muted); font-size:11px; cursor:pointer;" onclick="deleteTripInstance(${trip.id})">Delete</span>` : ''}
        `;
        settingsList.appendChild(row);
    });
}

function renderPeopleSelectors() {
    const expPaidByDropdown = document.getElementById('expPaidBy');
    const splitConsumersContainer = document.getElementById('splitConsumersContainer');
    const settingsPeopleList = document.getElementById('settingsPeopleManagementList');
    
    if(!expPaidByDropdown || !splitConsumersContainer || !settingsPeopleList) return;

    expPaidByDropdown.innerHTML = '';
    splitConsumersContainer.innerHTML = '';
    settingsPeopleList.innerHTML = '';

    let structuralList = globalPeopleList.filter(p => p.name !== 'me');
    structuralList.sort((a, b) => a.name.localeCompare(b.name));
    structuralList.unshift({ id: 0, name: 'me' });

    structuralList.forEach(person => {
        const opt = document.createElement('option');
        opt.value = person.name; opt.textContent = person.name;
        expPaidByDropdown.appendChild(opt);

        const checkLabel = document.createElement('label');
        checkLabel.className = 'checkbox-pill-item';
        checkLabel.innerHTML = `
            <input type="checkbox" class="expense-split-checkbox" value="${escapeHtml(person.name)}" checked>
            <span>${escapeHtml(person.name)}</span>
        `;
        splitConsumersContainer.appendChild(checkLabel);

        const row = document.createElement('div');
        row.className = 'list-item-row';
        row.innerHTML = `
            <span style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-pure)">
                <span class="ui-icon icon-person" style="width:14px; height:14px;"></span> ${escapeHtml(person.name)}
            </span>
            ${person.name !== 'me' ? `<span style="color:var(--danger-muted); font-size:11px; cursor:pointer;" onclick="deletePersonInstance(${person.id})">Remove</span>` : `<span style="color:var(--text-dim); font-size:11px;">Locked Default</span>`}
        `;
        settingsPeopleList.appendChild(row);
    });
}

async function deleteTripInstance(id) {
    if(!confirm("Are you sure? This will permanently wipe out all tracking logs inside this trip!")) return;
    try {
        const response = await fetch('/api/trips/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if(response.ok) {
            if(currentTripId === id) localStorage.removeItem('activeTripId');
            await pullTripsList(true);
        } else { alert("Failed to complete trip removal operations."); }
    } catch { alert("Network operation exception."); }
}

async function deletePersonInstance(id) {
    if(!confirm("Remove person from current roster layout? Existing history remains untouched.")) return;
    try {
        const response = await fetch('/api/people/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if(response.ok) { await pullDatabaseState(); }
    } catch { alert("Network exception."); }
}

function updateSyncBadge(status, message) {
    const badge = document.getElementById('syncBadge');
    const text = document.getElementById('syncStatusText');
    if(!badge || !text) return;
    badge.className = 'sync-status-pill ' + status;
    text.textContent = message;
}

async function makeApiRequest(url, payload = null) {
    try {
        const options = payload ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        } : { method: 'GET' };

        const response = await fetch(url, options);
        if (!response.ok) throw new Error();
        updateSyncBadge('synced', 'SQLite DB Active');
        return true;
    } catch {
        updateSyncBadge('error', 'DB Conn Error');
        return false;
    }
}

async function pullDatabaseState() {
    try {
        const response = await fetch(`/api/data?trip_id=${currentTripId}`);
        if(!response.ok) throw new Error();
        globalCachedData = await response.json();
        updateSyncBadge('synced', 'SQLite Connected');
        
        await pullPeopleList(); 
        renderUI();
    } catch { updateSyncBadge('error', 'DB Offline'); }
}

function renderUI() {
    const expCatSel = document.getElementById('expCategory');
    const targetMainSel = document.getElementById('targetMainSelect');
    if(!expCatSel || !targetMainSel) return;
    
    const previousSelection = expCatSel.value;
    expCatSel.innerHTML = '';
    targetMainSel.innerHTML = '';

    if (globalCachedData.categories && globalCachedData.categories.length > 0) {
        globalCachedData.categories.sort((a, b) => a.mainCat.localeCompare(b.mainCat));
        globalCachedData.categories.forEach(item => {
            const opt1 = document.createElement('option'); opt1.value = item.mainCat; opt1.textContent = item.mainCat;
            expCatSel.appendChild(opt1);
            const opt2 = document.createElement('option'); opt2.value = item.mainCat; opt2.textContent = item.mainCat;
            targetMainSel.appendChild(opt2);
        });
    }

    if(previousSelection && Array.from(expCatSel.options).some(o => o.value === previousSelection)) {
        expCatSel.value = previousSelection;
    }
    
    if(expCatSel.value) populateSubDropdown(expCatSel.value);
    renderLogsAndAnalytics();
}

function populateSubDropdown(mainCatName) {
    const subSelect = document.getElementById('expSubCategory');
    if(!subSelect) return;
    subSelect.innerHTML = '';
    
    if (!globalCachedData.categories) return;
    const record = globalCachedData.categories.find(c => c.mainCat === mainCatName);
    if (record && record.subs) {
        record.subs.sort().forEach(sub => {
            const opt = document.createElement('option'); opt.value = sub; opt.textContent = sub;
            subSelect.appendChild(opt);
        });
    }
}

function renderLogsAndAnalytics() {
    const historyList = document.getElementById('historyList');
    const analyticsList = document.getElementById('analyticsList');
    const totalText = document.getElementById('totalSpend');
    const debtsList = document.getElementById('groupDebtsList');
    const personTotalsSummaryList = document.getElementById('personTotalsSummaryList');
    const personTotalsSummaryCard = document.getElementById('personTotalsSummaryCard');
    
    const printTableLogBody = document.getElementById('printTableLogBody');
    const printAnalyticsSummary = document.getElementById('printAnalyticsSummary');
    const printGrandTotal = document.getElementById('printGrandTotal');

    if(!historyList || !analyticsList || !totalText) return;
    
    historyList.innerHTML = '';
    analyticsList.innerHTML = '';
    if(debtsList) debtsList.innerHTML = '';
    if(personTotalsSummaryList) personTotalsSummaryList.innerHTML = '';
    if(printTableLogBody) printTableLogBody.innerHTML = '';
    if(printAnalyticsSummary) printAnalyticsSummary.innerHTML = '';

    let grandTotal = 0;
    let reportStructure = {};
    
    let balanceSheet = {};
    let runningPersonTotals = {};
    
    globalPeopleList.forEach(p => { 
        balanceSheet[p.name] = 0.0; 
        runningPersonTotals[p.name] = 0.0;
    });

    if (globalCachedData.categories) {
        globalCachedData.categories.forEach(item => {
            reportStructure[item.mainCat] = { total: 0, subs: {}, personShares: {} };
            globalPeopleList.forEach(p => { reportStructure[item.mainCat].personShares[p.name] = 0.0; });
            if (item.subs) {
                item.subs.forEach(sub => { reportStructure[item.mainCat].subs[sub] = 0; });
            }
        });
    }

    if (globalCachedData.expenses && globalCachedData.expenses.length > 0) {
        globalCachedData.expenses.forEach(exp => {
            const amt = parseFloat(exp.amount || 0);
            const payer = exp.paid_by;
            
            let consumers = exp.split_with || [];
            if(consumers.length === 0) { consumers = ["me"]; }
            
            grandTotal += amt;
            const individualShare = amt / consumers.length;
            
            if (!(payer in balanceSheet)) balanceSheet[payer] = 0.0;
            balanceSheet[payer] += amt;
            
            consumers.forEach(consumer => {
                if (!(consumer in balanceSheet)) balanceSheet[consumer] = 0.0;
                balanceSheet[consumer] -= individualShare;
                
                if (!(consumer in runningPersonTotals)) runningPersonTotals[consumer] = 0.0;
                runningPersonTotals[consumer] += individualShare;
            });

            const descriptionStr = exp.description || '';
            const mainCatStr = exp.main_cat || 'Unassigned';
            const subCatStr = exp.sub_cat || 'Unassigned';

            if (!reportStructure[mainCatStr]) {
                reportStructure[mainCatStr] = { total: 0, subs: {}, personShares: {} };
            }
            if (!reportStructure[mainCatStr].personShares) {
                reportStructure[mainCatStr].personShares = {};
            }
            if (!reportStructure[mainCatStr].subs[subCatStr]) {
                reportStructure[mainCatStr].subs[subCatStr] = 0;
            }
            
            reportStructure[mainCatStr].total += amt;
            reportStructure[mainCatStr].subs[subCatStr] += amt;
            
            consumers.forEach(consumer => {
                if (!reportStructure[mainCatStr].personShares[consumer]) {
                    reportStructure[mainCatStr].personShares[consumer] = 0.0;
                }
                reportStructure[mainCatStr].personShares[consumer] += individualShare;
            });

            const dateObj = new Date(exp.timestamp);
            const displayTime = isNaN(dateObj) ? 'N/A' : dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            const consumersBadges = consumers.map(c => `<span style="font-size:10px; padding:2px 5px; background:var(--bg-deep); border:1px solid var(--border-line); border-radius:4px; margin-right:2px;">${escapeHtml(c)}</span>`).join('');

            const cardRow = document.createElement('div');
            cardRow.className = 'log-item';
            cardRow.innerHTML = `
                <div>
                    <div style="font-weight:500; font-size:14px;">${escapeHtml(descriptionStr)}</div>
                    <div class="log-meta" style="margin-bottom:6px;">
                        <span>Paid by <b>${escapeHtml(payer)}</b></span> &middot; 
                        <span>${displayTime}</span> &middot; 
                        <span class="tag-pill">${escapeHtml(mainCatStr)} &middot; ${escapeHtml(subCatStr)}</span>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:2px; margin-top:4px;">
                        <span style="font-size:10px; color:var(--text-dim); align-self:center; margin-right:4px;">Split:</span> ${consumersBadges}
                    </div>
                </div>
                <div style="text-align:right; flex-shrink:0;">
                    <div style="font-weight:600; color:var(--text-pure); font-size:14px; margin-bottom:4px;">₹${amt.toFixed(2)}</div>
                    <span style="color:var(--danger-muted); font-size:11px; cursor:pointer;" onclick="deleteExpenseEntry(${exp.id})">Remove</span>
                </div>
            `;
            historyList.appendChild(cardRow);

            if (printTableLogBody) {
                const printRow = document.createElement('tr');
                printRow.innerHTML = `
                    <td>${displayTime}</td>
                    <td style="font-weight: 500;">${escapeHtml(descriptionStr)}<br><small style="color:#6b7280; font-weight:400;">Payer: ${escapeHtml(payer)}</small></td>
                    <td><span style="font-size:11px; color:#4b5563;">${consumers.join(', ')}</span></td>
                    <td class="print-amount">₹${amt.toFixed(2)}</td>
                `;
                printTableLogBody.appendChild(printRow);
            }
        });
    }

    totalText.textContent = `₹${grandTotal.toFixed(2)}`;
    if (printGrandTotal) printGrandTotal.textContent = `₹${grandTotal.toFixed(2)}`;

    // Group Debt Matrix Calculations
    if (globalPeopleList.length > 0 && debtsList) {
        document.getElementById('groupBreakdownCard').style.display = 'block';
        
        let debtors = [];
        let creditors = [];
        
        Object.keys(balanceSheet).forEach(name => {
            let bal = balanceSheet[name];
            if (bal < -0.01) {
                debtors.push({ name: name, balance: Math.abs(bal) });
            } else if (bal > 0.01) {
                creditors.push({ name: name, balance: bal });
            }
        });

        let dIdx = 0; let cIdx = 0;
        while (dIdx < debtors.length && cIdx < creditors.length) {
            let debtor = debtors[dIdx];
            let creditor = creditors[cIdx];
            let settlementAmount = Math.min(debtor.balance, creditor.balance);
            
            debtor.balance -= settlementAmount;
            creditor.balance -= settlementAmount;
            
            const pRow = document.createElement('div');
            pRow.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 1px solid var(--border-line);";
            pRow.innerHTML = `
                <span style="display:flex; align-items:center; gap:6px;">
                    <span class="ui-icon icon-arrow-right" style="color:var(--danger-muted); width:14px; height:14px;"></span>
                    <span><b>${escapeHtml(debtor.name)}</b> owes <b>${escapeHtml(creditor.name)}</b></span>
                </span>
                <span style="color:var(--danger-muted); font-weight:600;">₹${settlementAmount.toFixed(2)}</span>
            `;
            debtsList.appendChild(pRow);
            
            if (debtor.balance <= 0.01) dIdx++;
            if (creditor.balance <= 0.01) cIdx++;
        }
        
        if (debtsList.children.length === 0) {
            debtsList.innerHTML = `<p style="color:var(--success-glow); text-align:center; font-size:12px; margin:4px 0;">🎉 All transactions are perfectly squared up!</p>`;
        }
    } else if (debtsList) {
        document.getElementById('groupBreakdownCard').style.display = 'none';
    }

    // Category Chart Generator loop with Per Person allocations
    Object.keys(reportStructure).forEach(main => {
        const data = reportStructure[main];
        if (data.total > 0) {
            const percentage = grandTotal > 0 ? ((data.total / grandTotal) * 100).toFixed(0) : 0;
            
            let subHtml = '';
            let printSubHtml = '';
            Object.keys(data.subs).forEach(sub => {
                const subAmt = data.subs[sub];
                if (subAmt > 0) {
                    const subPercentage = ((subAmt / data.total) * 100).toFixed(0);
                    const metricRow = `
                        <div class="sub-metric-row">
                            <span>↳ ${escapeHtml(sub)} <span style="color:var(--text-dim); font-size:9px;">(${subPercentage}%)</span></span>
                            <span>₹${subAmt.toFixed(2)}</span>
                        </div>
                    `;
                    subHtml += metricRow;
                    printSubHtml += `<div style="display:flex; justify-content:space-between; font-size:11px; color:#4b5563; padding-left:12px; margin-top:2px;"><span>↳ ${escapeHtml(sub)} (${subPercentage}%)</span><span>₹${subAmt.toFixed(2)}</span></div>`;
                }
            });

            let personSharesHtml = '';
            let printPersonSharesHtml = '';
            if (data.personShares) {
                Object.keys(data.personShares).forEach(pName => {
                    const pShare = data.personShares[pName];
                    if (pShare > 0.01) {
                        personSharesHtml += `<span class="person-spend-badge"><b>${escapeHtml(pName)}</b>: ₹${pShare.toFixed(2)}</span>`;
                        printPersonSharesHtml += `<span style="font-size:10px; padding:1px 4px; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:3px; margin-right:4px; color:#374151;"><b>${escapeHtml(pName)}</b>: ₹${pShare.toFixed(2)}</span>`;
                    }
                });
            }

            const div = document.createElement('div');
            div.className = 'chart-row';
            div.innerHTML = `
                <div class="chart-labels">
                    <span style="color:var(--text-pure); font-size:12px;">${escapeHtml(main)} <span style="color:var(--text-dim); font-size:10px; margin-left:4px;">${percentage}%</span></span>
                    <strong style="font-weight:500;">₹${data.total.toFixed(2)}</strong>
                </div>
                <div class="chart-bar-bg"><div class="chart-bar-fill" style="width: ${percentage}%"></div></div>
                <div class="sub-metrics-list">${subHtml}</div>
                <div class="person-spend-badge-container">
                    ${personSharesHtml || '<span class="person-spend-badge" style="border:none; padding:0;">No individual shares recorded</span>'}
                </div>
            `;
            analyticsList.appendChild(div);

            if (printAnalyticsSummary) {
                const printDiv = document.createElement('div');
                printDiv.style.cssText = "margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #e5e7eb;";
                printDiv.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-weight:600; font-size:12px; color:#111827;">
                        <span>${escapeHtml(main)} (${percentage}%)</span>
                        <span>₹${data.total.toFixed(2)}</span>
                    </div>
                    <div style="margin-top:2px;">${printSubHtml}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:2px; margin-top:6px; padding-top:4px; border-top:1px dashed #e5e7eb;">${printPersonSharesHtml}</div>
                `;
                printAnalyticsSummary.appendChild(printDiv);
            }
        }
    });

    // Render: Final Aggregated Spends per Person Summary Box
    if (personTotalsSummaryList && personTotalsSummaryCard) {
        let sortedTotals = Object.keys(runningPersonTotals).filter(pName => runningPersonTotals[pName] > 0);
        sortedTotals.sort((a, b) => runningPersonTotals[b] - runningPersonTotals[a]);

        if (sortedTotals.length > 0) {
            personTotalsSummaryCard.style.display = 'block';
            
            if (printAnalyticsSummary) {
                const summaryTitle = document.createElement('div');
                summaryTitle.className = 'print-section-title';
                summaryTitle.style.cssText = "margin-top:16px; margin-bottom:8px; font-weight:700; text-transform:uppercase; font-size:11px; color:#4b5563; border-bottom:2px solid #374151; padding-bottom:3px;";
                summaryTitle.textContent = "Total Spend Summary per Person";
                printAnalyticsSummary.appendChild(summaryTitle);
            }

            sortedTotals.forEach(pName => {
                const totalSpend = runningPersonTotals[pName];
                const row = document.createElement('div');
                row.className = 'summary-total-row';
                row.innerHTML = `
                    <span style="display:flex; align-items:center; gap:8px;">
                        <span class="ui-icon icon-person" style="width:14px; height:14px;"></span>
                        <span><b>${escapeHtml(pName)}</b></span>
                    </span>
                    <span style="color:var(--accent-glow); font-weight:600;">₹${totalSpend.toFixed(2)}</span>
                `;
                personTotalsSummaryList.appendChild(row);

                if (printAnalyticsSummary) {
                    const printTotalRow = document.createElement('div');
                    printTotalRow.style.cssText = "display:flex; justify-content:space-between; font-size:12px; padding:4px 0; color:#111827;";
                    printTotalRow.innerHTML = `<span>👤 <b>${escapeHtml(pName)}</b></span><span style="font-weight:600;">₹${totalSpend.toFixed(2)}</span>`;
                    printAnalyticsSummary.appendChild(printTotalRow);
                }
            });
        } else {
            personTotalsSummaryCard.style.display = 'none';
        }
    }

    if(!globalCachedData.expenses || globalCachedData.expenses.length === 0) {
        historyList.innerHTML = `<p style="color:var(--text-dim); text-align:center; font-size:12px; padding:20px 0;">No logs found inside database.</p>`;
        analyticsList.innerHTML = `<p style="color:var(--text-dim); text-align:center; font-size:12px; padding:16px 0;">No metrics compiled.</p>`;
        if(personTotalsSummaryCard) personTotalsSummaryCard.style.display = 'none';
    }
}

document.getElementById('expenseForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const paidBy = document.getElementById('expPaidBy').value;
    if(!paidBy) { alert("Please select a valid payer entry."); return; }

    const checkedBoxes = document.querySelectorAll('.expense-split-checkbox:checked');
    let splitWith = Array.from(checkedBoxes).map(cb => cb.value);
    if(splitWith.length === 0) { splitWith = ["me"]; }

    const timestamp = document.getElementById('expDateTime').value;
    const desc = document.getElementById('expDesc').value.trim();
    const amount = document.getElementById('expAmount').value;
    const mainCat = document.getElementById('expCategory').value;
    const subCat = document.getElementById('expSubCategory').value;

    const ok = await makeApiRequest('/api/expense/add', { 
        desc, amount, mainCat, subCat, timestamp, paidBy, trip_id: currentTripId, splitWith 
    });
    if(ok) {
        document.getElementById('expDesc').value = '';
        document.getElementById('expAmount').value = '';
        setDefaultDateTime();
        await pullDatabaseState();
    }
});

document.getElementById('addMainBtn').addEventListener('click', async function() {
    const input = document.getElementById('newMainInput');
    const mainCat = input.value.trim();
    if (!mainCat) return;
    const ok = await makeApiRequest('/api/category/add_main', { mainCat });
    if(ok) { input.value = ''; await pullDatabaseState(); }
});

document.getElementById('addSubBtn').addEventListener('click', async function() {
    const mainTarget = document.getElementById('targetMainSelect').value;
    const input = document.getElementById('newSubInput');
    const subName = input.value.trim();
    if (!mainTarget || !subName) return;

    const ok = await makeApiRequest('/api/category/add_sub', { mainCat: mainTarget, subCat: subName });
    if(ok) { input.value = ''; await pullDatabaseState(); }
});

async function deleteExpenseEntry(id) {
    const ok = await makeApiRequest('/api/expense/delete', { id });
    if(ok) await pullDatabaseState();
}

async function clearAllDatabaseLogs() {
    if (!confirm("Wipe all tracking logs inside this trip permanently?")) return;
    const ok = await makeApiRequest('/api/clear', { trip_id: currentTripId });
    if(ok) await pullDatabaseState();
}

function exportDataSnapshot() {
    const blob = new Blob([JSON.stringify(globalCachedData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `trip_${currentTripId}_backup_snapshot.json`; a.click();
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
