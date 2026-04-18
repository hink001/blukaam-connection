// Mobile Menu
function toggleMenu() {
  const m = document.getElementById('mobileMenu');
  m.classList.toggle('open');
}

// Filter tab active state
function filterProfiles(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    document.getElementById('mobileMenu').classList.remove('open');
  });
});

// Show worker profile smooth scroll
function showWorkerProfile() {
  document.getElementById('worker-profile').scrollIntoView({ behavior: 'smooth' });
}

// RADAR CHART
window.addEventListener('load', () => {
  const radarCtx = document.getElementById('radarChart');
  if (radarCtx) {
    new Chart(radarCtx, {
      type: 'radar',
      data: {
        labels: ['Wiring', 'Fan Install', 'DB Board', 'Solar Panel', 'CCTV', 'Earthing'],
        datasets: [{
          label: 'Skill Proficiency (%)',
          data: [90, 85, 80, 65, 55, 88],
          backgroundColor: 'rgba(30, 136, 229, 0.15)',
          borderColor: '#1E88E5',
          borderWidth: 2,
          pointBackgroundColor: '#F57C00',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#F57C00',
          pointRadius: 5,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            angleLines: { color: 'rgba(0,0,0,0.08)' },
            grid: { color: 'rgba(0,0,0,0.08)' },
            pointLabels: { font: { size: 12, family: 'Noto Sans' }, color: '#475569' },
            ticks: { display: false },
            min: 0, max: 100,
          }
        }
      }
    });
  }

  const expCtx = document.getElementById('expChart');
  if (expCtx) {
    new Chart(expCtx, {
      type: 'bar',
      data: {
        labels: ['Wiring & Circuits', 'Fan/Light Install', 'DB Board Setup', 'Solar Systems', 'CCTV/Security'],
        datasets: [{
          label: 'Years of Experience',
          data: [8, 7, 5, 2, 3],
          backgroundColor: ['#0D2F6E', '#1565C0', '#1E88E5', '#42A5F5', '#90CAF9'],
          borderRadius: 6, borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { size: 12 }, color: '#475569', stepSize: 2 },
            grid: { color: 'rgba(0,0,0,0.06)' },
            title: { display: true, text: 'Years', color: '#94A3B8', font: { size: 12 } }
          },
          x: {
            ticks: { font: { size: 11 }, color: '#475569', maxRotation: 20 },
            grid: { display: false }
          }
        }
      }
    });
  }
});

// --- Registration Logic ---
// We use a standalone page (login.html) now so no modal popup JavaScript is needed.

// Switch between Worker & Contractor forms
function switchRole(role) {
  document.getElementById('regRole').value = role;
  
  const btnWorker = document.getElementById('btnRoleWorker');
  const btnContractor = document.getElementById('btnRoleContractor');
  const grpWorkType = document.getElementById('grpWorkType');
  const grpSkills = document.getElementById('grpSkills');
  const grpCompanyName = document.getElementById('grpCompanyName');

  if (role === 'Worker') {
    btnWorker.classList.add('active');
    btnContractor.classList.remove('active');
    grpWorkType.style.display = 'block';
    grpSkills.style.display = 'block';
    grpCompanyName.style.display = 'none';
  } else {
    btnContractor.classList.add('active');
    btnWorker.classList.remove('active');
    grpWorkType.style.display = 'none';
    grpSkills.style.display = 'none';
    grpCompanyName.style.display = 'block';
  }
}

// Handle Form Submit (Seamless Registration)
async function handleRegistration(e) {
  e.preventDefault(); // Stop page reload

  const payload = {
    role: document.getElementById('regRole').value,
    name: document.getElementById('regName').value.trim(),
    phone: document.getElementById('regPhone').value.trim(),
    email: "", // Not used in simple form
    industry: document.getElementById('regIndustry').value.trim(),
    workType: document.getElementById('regWorkType') ? document.getElementById('regWorkType').value.trim() : "",
    companyName: document.getElementById('regCompany') ? document.getElementById('regCompany').value.trim() : "",
    skills: document.getElementById('regSkills') ? document.getElementById('regSkills').value.split(',').map(s => s.trim()) : [],
    city: document.getElementById('regCity').value.trim(),
    state: document.getElementById('regState').value.trim(),
    pincode: document.getElementById('regPincode').value.trim()
  };

  try {
    const response = await fetch('http://localhost:3000/api/profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.ok) {
      alert("Registration Successful!");
      document.getElementById('registrationForm').reset();
      
      // Auto-issue a standard pass token since we don't do OTP right now
      localStorage.setItem('blukaam_token', 'temp-auth-token-mvp');
      
      window.location.href = "dashboard.html"; // Redirect to dashboard on success
    } else {
      alert("Failed: " + (result.error || "Unknown error"));
      console.error(result);
    }
  } catch (error) {
    alert("Network Error! Ensure your backend node server.js is running.");
    console.error(error);
  }
}