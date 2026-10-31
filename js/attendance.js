/**
 * export-import.js - CSV generation with quoting/escaping and JSON backup restore
 */

import {
  getAllAttendance,
  getAllStudents,
  getSetting,
  openDatabase,
  clearEntireDatabase
} from './database.js';
import { escapeCSVCell, showToast } from './utils.js';

export function initExportImportModule(onDataRestored) {
  const btnExportCSV = document.getElementById('btn-export-csv');
  const btnExportBackup = document.getElementById('btn-export-backup');
  const fileInput = document.getElementById('import-backup-file');
  const btnTriggerImport = document.getElementById('btn-trigger-import');
  const btnPurge = document.getElementById('btn-purge-database');

  btnExportCSV.addEventListener('click', async () => {
    const records = await getAllAttendance();
    const filterDate = document.getElementById('filter-date').value;
    const filterClass = document.getElementById('filter-class').value.trim().toLowerCase();
    const filterMethod = document.getElementById('filter-method').value;

    const filtered = records.filter(r => {
      if (filterDate && r.date !== filterDate) return false;
      if (filterClass && !r.classSection.toLowerCase().includes(filterClass)) return false;
      if (filterMethod && !r.method.startsWith(filterMethod)) return false;
      return true;
    });

    if (filtered.length === 0) {
      showToast('No records available to export for the given criteria.', 'warning');
      return;
    }

    filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const headers = ['Record_ID', 'Timestamp_ISO', 'Student_ID', 'Full_Name', 'Class_Section', 'Status', 'Method', 'Confidence_Metric'];
    const rows = filtered.map(r => [
      escapeCSVCell(r.id),
      escapeCSVCell(r.timestamp),
      escapeCSVCell(r.studentId),
      escapeCSVCell(r.name),
      escapeCSVCell(r.classSection),
      escapeCSVCell(r.status),
      escapeCSVCell(r.method),
      escapeCSVCell(r.confidenceScore)
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const datePrefix = filterDate ? filterDate : new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Attendance_Report_${datePrefix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${filtered.length} records to CSV.`, 'success');
  });

  btnExportBackup.addEventListener('click', async () => {
    try {
      const students = await getAllStudents();
      const attendance = await getAllAttendance();
      const matchThreshold = await getSetting('matchThreshold', 0.50);
      const allowMultiple = await getSetting('allowMultipleEntries', false);

      const backupData = {
        meta: {
          system: 'VeriFace Attendance System',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          totalStudents: students.length,
          totalAttendanceLogs: attendance.length
        },
        settings: {
          matchThreshold,
          allowMultipleEntries: allowMultiple
        },
        students,
        attendance
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];

      link.href = url;
      link.download = `VeriFace_Backup_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Biometric database backup downloaded.', 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    }
  });

  btnTriggerImport.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('Restoring this backup will merge or overwrite current records. Proceed?')) {
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const payload = JSON.parse(event.target.result);

        if (!payload.students || !Array.isArray(payload.students) || !payload.attendance || !Array.isArray(payload.attendance)) {
          throw new Error('Invalid backup file format: Missing students or attendance collections.');
        }

        const db = await openDatabase();
        const tx = db.transaction(['students', 'attendance'], 'readwrite');
        const stuStore = tx.objectStore('students');
        const attStore = tx.objectStore('attendance');

        let studentsAdded = 0;
        for (const s of payload.students) {
          if (s.studentId && s.name && s.descriptor) {
            stuStore.put(s);
            studentsAdded++;
          }
        }

        let logsAdded = 0;
        for (const a of payload.attendance) {
          if (a.studentId && a.timestamp && a.date) {
            delete a.id;
            attStore.add(a);
            logsAdded++;
          }
        }

        tx.oncomplete = () => {
          showToast(`Restored: ${studentsAdded} students and ${logsAdded} attendance logs.`, 'success');
          fileInput.value = '';
          if (onDataRestored) onDataRestored();
        };

        tx.onerror = (err) => {
          showToast(`Transaction failed: ${err.target.error}`, 'error');
        };
      } catch (err) {
        showToast('Restore rejected: ' + err.message, 'error');
        fileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  btnPurge.addEventListener('click', async () => {
    const userPrompt = prompt('WARNING: This permanently removes all local face descriptors and logs. Type "DELETE" to confirm:');
    if (userPrompt === 'DELETE') {
      await clearEntireDatabase();
      showToast('Local database wiped clean.', 'info');
      if (onDataRestored) onDataRestored();
    } else {
      showToast('Purge aborted: Confirmation phrase did not match.', 'info');
    }
  });
}
