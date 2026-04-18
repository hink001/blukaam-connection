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

// --- OTP & AUTHENTICATION FLOW (REVERSED) ---
let pendingRegistrationData = null;
let currentIdentifier = "";

function showLoginOnly() {
    document.getElementById('authStep1').style.display = 'none';
    document.getElementById('authLoginOnly').style.display = 'block';
}

async function handleRegistrationSubmit(e) {
    e.preventDefault();
    const phone = document.getElementById('regPhone').value.trim();
    if (!phone) return alert("Phone Number is required.");
    
    // Store data temporarily until verified
    pendingRegistrationData = {
        role: document.getElementById('regRole').value,
        name: document.getElementById('regName').value.trim(),
        phone: phone,
        email: "",
        industry: document.getElementById('regIndustry').value.trim(),
        workType: document.getElementById('regWorkType') ? document.getElementById('regWorkType').value.trim() : "",
        companyName: document.getElementById('regCompany') ? document.getElementById('regCompany').value.trim() : "",
        skills: document.getElementById('regSkills') ? document.getElementById('regSkills').value.split(',').map(s => s.trim()) : [],
        city: document.getElementById('regCity').value.trim(),
        state: document.getElementById('regState').value.trim(),
        pincode: document.getElementById('regPincode').value.trim()
    };
    
    currentIdentifier = phone;
    await triggerSendOtp();
}

async function sendLoginOtp() {
    const phone = document.getElementById('authIdentifier').value.trim();
    if (!phone) return alert("Please enter your Phone Number.");
    currentIdentifier = phone;
    pendingRegistrationData = null; // Mark as Login attempt only
    await triggerSendOtp();
}

async function triggerSendOtp() {
    try {
        const res = await fetch('http://localhost:3000/api/auth/send-otp', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ identifier: currentIdentifier })
        });
        if (res.ok) {
            document.getElementById('authStep1').style.display = 'none';
            document.getElementById('authLoginOnly').style.display = 'none';
            document.getElementById('authStep2').style.display = 'block';
            document.getElementById('authOtp').focus();
        } else {
            alert("Failed to send OTP... Check server logs.");
        }
    } catch(e) { 
        alert("Network Error! Ensure your node server.js is running."); 
    }
}

async function verifyOtp() {
    const otpCode = document.getElementById('authOtp').value.trim();
    if (otpCode.length !== 6) return alert("Please enter the 6-digit OTP");
    
    try {
        const res = await fetch('http://localhost:3000/api/auth/verify-otp', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ identifier: currentIdentifier, otp: otpCode })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            localStorage.setItem('blukaam_token', data.token); // Secure User Token
            
            // IF NEW REGISTRATION FLOW
            if (pendingRegistrationData) {
               const profileRes = await fetch('http://localhost:3000/api/profiles', {
                   method: 'POST', headers: {'Content-Type': 'application/json'},
                   body: JSON.stringify(pendingRegistrationData)
               });
               if (profileRes.ok) {
                   alert("Registration Verified & Successful!");
                   window.location.href = "dashboard.html";
               } else {
                   alert("Registration data failed to save.");
               }
            } 
            // IF RETURNING LOGIN FLOW
            else {
               if (data.isNewUser) {
                   alert("No account found! Please register a profile first.");
                   window.location.reload();
               } else {
                   alert("Successfully logged in!");
                   window.location.href = "dashboard.html";
               }
            }
        } else {
            alert("Verification Failed: " + (data.error || "Wrong code"));
        }
    } catch(e) { 
        alert("Network error verifying OTP"); 
    }
}