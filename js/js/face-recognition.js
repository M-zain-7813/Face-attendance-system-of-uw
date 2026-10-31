/**
 * students.js - Registry UI, CRUD workflows, and camera face enrollment
 */

import { getAllStudents, addStudent, deleteStudent, getStudentById } from './database.js';
import { computeDescriptorFromMedia, stopCameraStream } from './face-recognition.js';
import { showToast, formatDate } from './utils.js';

let enrolledDescriptor = null;
let enrollStream = null;

export function initStudentsModule(onStudentsChanged) {
  const btnOpenModal = document.getElementById('btn-open-student-modal');
  const btnCloseModal = document.getElementById('btn-close-enroll-modal');
  const btnCancelModal = document.getElementById('btn-cancel-enrollment');
  const modal = document.getElementById('modal-enrollment');
  const form = document.getElementById('form-enroll-student');
  const searchInput = document.getElementById('student-search');

  const btnStartEnrollCam = document.getElementById('btn-start-enroll-cam');
  const btnCaptureFace = document.getElementById('btn-capture-face');
  const videoEnroll = document.getElementById('enroll-video');
  const overlayText = document.getElementById('enroll-overlay-text');
  const biometricStatus = document.getElementById('enroll-biometric-status');

  btnOpenModal.addEventListener('click', () => {
    resetEnrollmentForm();
    modal.classList.add('open');
  });

  const closeModal = () => {
    stopEnrollCamera();
    modal.classList.remove('open');
  };
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  searchInput.addEventListener('input', (e) => {
    renderStudentsTable(e.target.value.trim().toLowerCase());
  });

  btnStartEnrollCam.addEventListener('click', async () => {
    try {
      if (enrollStream) stopEnrollCamera();
      enrollStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      });
      videoEnroll.srcObject = enrollStream;
      overlayText.style.display = 'none';
      btnCaptureFace.disabled = false;
      showToast('Enrollment camera active.', 'info');
    } catch (err) {
      console.error(err);
      showToast('Camera access denied or unavailable: ' + err.message, 'error');
    }
  });

  btnCaptureFace.addEventListener('click', async () => {
    biometricStatus.textContent = 'Extracting 128-d face descriptor...';
    try {
      const descriptor = await computeDescriptorFromMedia(videoEnroll);
      if (!descriptor) {
        biometricStatus.textContent = 'Capture failed: No face detected. Adjust lighting and face directly.';
        showToast('No face detected. Please face the camera directly.', 'warning');
        return;
      }
      enrolledDescriptor = descriptor;
      biometricStatus.textContent = 'Facial descriptor captured successfully (128-point embedding generated).';
      biometricStatus.style.color = '#10b981';
      showToast('Facial descriptor generated successfully.', 'success');
    } catch (err) {
      biometricStatus.textContent = 'Error during biometric extraction.';
      showToast(err.message, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!enrolledDescriptor) {
      showToast('Cannot save student: Valid face capture is strictly required.', 'error');
      return;
    }

    const studentId = document.getElementById('enroll-id').value.trim();
    const name = document.getElementById('enroll-name').value.trim();
    const classSection = document.getElementById('enroll-class').value.trim();
    const email = document.getElementById('enroll-email').value.trim();
    const phone = document.getElementById('enroll-phone').value.trim();

    const studentRecord = {
      studentId,
      name,
      classSection,
      email,
      phone,
      descriptor: enrolledDescriptor,
      createdAt: new Date().toISOString()
    };

    try {
      await addStudent(studentRecord);
      showToast(`Student ${name} (${studentId}) enrolled.`, 'success');
      closeModal();
      renderStudentsTable();
      if (onStudentsChanged) onStudentsChanged();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  function stopEnrollCamera() {
    stopCameraStream(videoEnroll);
    enrollStream = null;
    overlayText.style.display = 'flex';
    btnCaptureFace.disabled = true;
  }

  function resetEnrollmentForm() {
    form.reset();
    enrolledDescriptor = null;
    biometricStatus.textContent = 'No biometric template captured yet.';
    biometricStatus.style.color = '';
    stopEnrollCamera();
  }

  renderStudentsTable();
}

export async function renderStudentsTable(filterText = '') {
  const tbody = document.getElementById('students-table-body');
  if (!tbody) return;

  const students = await getAllStudents();

  const filtered = students.filter(s => {
    if (!filterText) return true;
    return (
      s.name.toLowerCase().includes(filterText) ||
      s.studentId.toLowerCase().includes(filterText) ||
      s.classSection.toLowerCase().includes(filterText)
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center">No matching student records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const hasBiometric = s.descriptor && s.descriptor.length === 128;
    return `
      <tr>
        <td><strong>${escapeHTML(s.studentId)}</strong></td>
        <td>${escapeHTML(s.name)}</td>
        <td>${escapeHTML(s.classSection)}</td>
        <td>${escapeHTML(s.email || '-')}</td>
        <td>
          <span class="badge ${hasBiometric ? 'badge-success' : 'badge-warning'}">
            ${hasBiometric ? '128-D Enrolled' : 'Missing'}
          </span>
        </td>
        <td>${formatDate(s.createdAt)}</td>
        <td>
          <button class="btn btn-outline btn-sm btn-delete-stu" data-id="${escapeHTML(s.studentId)}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-delete-stu').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-id');
      if (confirm(`Are you sure you want to delete student ${id}? This cannot be undone.`)) {
        await deleteStudent(id);
        showToast(`Student ${id} removed.`, 'info');
        renderStudentsTable(filterText);
      }
    });
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
