/**
 * app.js - Main Application Coordinator & Dashboard Analytics
 */

import { loadFaceModels } from './face-recognition.js';
import { initStudentsModule, renderStudentsTable } from './students.js';
import { initAttendanceModule, renderAttendanceTable } from './attendance.js';
import { initExportImportModule } from './export-import.js';
import { getAllStudents, getAllAttendance, getSetting, setSetting } from './database.js';
import { showToast, formatDate, formatTime } from './utils.js';

async function startSystem() {
  initClock();
  initNavigation();
  initSettingsControls();

  const indicator = document.getElementById('model-status-indicator');
  const statusText = document.getElementById('model-status-text');

  try {
    await loadFaceModels((msg) => {
      if (statusText) statusText.textContent = msg;
    });
    if (indicator) {
      indicator.classList.remove('error');
      indicator.classList.add('ready');
    }
    if (statusText) statusText.textContent = 'Models Online (WASM/WebGL)';
  } catch (err) {
    if (indicator) indicator.classList.add('error');
    if (statusText) statusText.textContent = 'Model Load Failed';
    showToast('Failed to load neural models: ' + err.message, 'error');
  }

  const refreshAll = async () => {
    await renderDashboardMetrics();
    await renderStudentsTable();
    await renderAttendanceTable();
  };

  initStudentsModule(refreshAll);
  await initAttendanceModule(refreshAll);
  initExportImportModule(refreshAll);

  await renderDashboardMetrics();
}

// Mobile browsers par DOMContentLoaded miss hone se bachane ke liye safe launcher:
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startSystem);
} else {
  startSystem();
}

function initClock() {
  const clockEl = document.getElementById('live-clock');
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = `${now.toLocaleTimeString()} | ${now.toLocaleDateString()}`;
  };
  setInterval(update, 1000);
  update();
}

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.tab-panel');
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      navItems.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(`tab-${tabId}`);
      if (targetPanel) targetPanel.classList.add('active');

      if (sidebar) sidebar.classList.remove('mobile-open');
    });
  });

  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }
}

async function renderDashboardMetrics() {
  const students = await getAllStudents();
  const attendance = await getAllAttendance();
  const today = new Date().toISOString().split('T')[0];

  const presentTodayMap = new Set();
  const todayRecords = [];

  for (const a of attendance) {
    if (a.date === today) {
      presentTodayMap.add(a.studentId);
      todayRecords.push(a);
    }
  }

  const totalStu = students.length;
  const presentCount = presentTodayMap.size;
  const absentCount = Math.max(0, totalStu - presentCount);
  const rate = totalStu > 0 ? Math.round((presentCount / totalStu) * 100) : 0;

  const elTotal = document.getElementById('dash-total-students');
  const elPresent = document.getElementById('dash-today-present');
  const elAbsent = document.getElementById('dash-today-absent');
  const elRate = document.getElementById('dash-attendance-rate');

  if (elTotal) elTotal.textContent = totalStu;
  if (elPresent) elPresent.textContent = presentCount;
  if (elAbsent) elAbsent.textContent = absentCount;
  if (elRate) elRate.textContent = `${rate}%`;

  renderWeeklyChart(attendance);
  renderRecentFeed(todayRecords);
}

function renderWeeklyChart(allAttendance) {
  const container = document.getElementById('dash-weekly-chart');
  if (!container) return;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const countsByDay = {};
  days.forEach(day => { countsByDay[day] = new Set(); });

  allAttendance.forEach(a => {
    if (countsByDay[a.date]) {
      countsByDay[a.date].add(a.studentId);
    }
  });

  const dailyValues = days.map(d => ({
    date: d,
    dayName: new Date(d).toLocaleDateString(undefined, { weekday: 'short' }),
    count: countsByDay[d].size
  }));

  const maxVal = Math.max(...dailyValues.map(v => v.count), 5);

  container.innerHTML = dailyValues.map(v => {
    const heightPercent = Math.round((v.count / maxVal) * 100);
    return `
      <div class="chart-col">
        <span class="chart-val">${v.count}</span>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="height: ${heightPercent}%;"></div>
        </div>
        <span class="chart-label">${v.dayName}</span>
      </div>
    `;
  }).join('');
}

function renderRecentFeed(todayRecords) {
  const feedContainer = document.getElementById('dash-recent-feed');
  if (!feedContainer) return;

  if (todayRecords.length === 0) {
    feedContainer.innerHTML = '<p class="placeholder-text">No attendance activity recorded today.</p>';
    return;
  }

  todayRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recent = todayRecords.slice(0, 6);

  feedContainer.innerHTML = recent.map(r => `
    <div class="feed-item">
      <div>
        <div class="feed-item-name">${r.name}</div>
        <div class="feed-item-sub">${r.studentId} &bull; ${r.classSection}</div>
      </div>
      <div class="feed-item-time">${formatTime(r.timestamp)}</div>
    </div>
  `).join('');
}

async function initSettingsControls() {
  const thresholdRange = document.getElementById('setting-threshold');
  const thresholdVal = document.getElementById('val-threshold');
  const chkMultiple = document.getElementById('setting-allow-duplicates');
  const chkLiveness = document.getElementById('setting-enable-liveness');
  const btnSave = document.getElementById('btn-save-settings');

  if (!thresholdRange) return;

  const currentThreshold = await getSetting('matchThreshold', 0.50);
  const currentMultiple = await getSetting('allowMultipleEntries', false);
  const currentLiveness = await getSetting('enableLiveness', false);

  thresholdRange.value = currentThreshold;
  if (thresholdVal) thresholdVal.textContent = parseFloat(currentThreshold).toFixed(2);
  if (chkMultiple) chkMultiple.checked = !!currentMultiple;
  if (chkLiveness) chkLiveness.checked = !!currentLiveness;

  thresholdRange.addEventListener('input', (e) => {
    if (thresholdVal) thresholdVal.textContent = parseFloat(e.target.value).toFixed(2);
  });

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      await setSetting('matchThreshold', parseFloat(thresholdRange.value));
      await setSetting('allowMultipleEntries', chkMultiple ? chkMultiple.checked : false);
      await setSetting('enableLiveness', chkLiveness ? chkLiveness.checked : false);
      showToast('Biometric settings saved.', 'success');
    });
  }
}
