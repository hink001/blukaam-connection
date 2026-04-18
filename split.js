const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

const headRegex = /<!DOCTYPE html>[\s\S]*?<body>/i;
const navRegex = /<!-- NAV -->[\s\S]*?<\/nav>/i;
const mobileNavRegex = /<!-- Mobile Menu -->[\s\S]*?<\/div>/i;
const footerRegex = /<!-- FOOTER -->[\s\S]*?<\/footer>/i;
const scriptsRegex = /<script src="script\.js"><\/script>[\s\S]*?<\/html>/i;

const headMatches = html.match(headRegex);
const navMatches = html.match(navRegex);
const mobileNavMatches = html.match(mobileNavRegex);
const footerMatches = html.match(footerRegex);
const scriptsMatches = html.match(scriptsRegex);

if (!headMatches || !navMatches || !mobileNavMatches || !footerMatches || !scriptsMatches) {
    console.error("Regex match failed for core layout components.");
    process.exit(1);
}

const layoutStart = `${headMatches[0]}\n\n${navMatches[0]}\n\n${mobileNavMatches[0]}\n\n`;
const layoutEnd = `\n\n${footerMatches[0]}\n\n${scriptsMatches[0]}`;

// Helper to fix nav links from anchor to absolute on the pages
function fixLinks(content) {
    let newContent = content;
    newContent = newContent.replace(/href="#skills"/g, 'href="index.html#skills"');
    newContent = newContent.replace(/href="#jobs"/g, 'href="jobs.html"');
    newContent = newContent.replace(/href="#training"/g, 'href="training.html"');
    newContent = newContent.replace(/href="#contractor"/g, 'href="jobs.html#contractor"');
    newContent = newContent.replace(/href="#about"/g, 'href="index.html#about"');
    newContent = newContent.replace(/<a href="#" class="nav-cta">Login \/ Sign Up<\/a>/g, '<a href="login.html" class="nav-cta">Login / Sign Up</a>');
    newContent = newContent.replace(/style="color: var\(--blue-mid\);">Login \/ Sign Up<\/a>/g, 'href="login.html" style="color: var(--blue-mid);">Login / Sign Up</a>');
    return newContent;
}

// 1. CREATE workers.html
const workersData = html.match(/<!-- WORKER PROFILES BROWSE -->[\s\S]*?<!-- JOBS SECTION -->/)[0].replace('<!-- JOBS SECTION -->', '');
fs.writeFileSync('workers.html', fixLinks(layoutStart + workersData + layoutEnd));
console.log('Created workers.html');

// 2. CREATE jobs.html
const jobsData1 = html.match(/<!-- JOBS SECTION -->[\s\S]*?<!-- CONTRACTOR SECTION -->/)[0].replace('<!-- CONTRACTOR SECTION -->', '');
const jobsData2 = html.match(/<!-- CONTRACTOR SECTION -->[\s\S]*?<!-- TRAINING \/ LEARNING HUB -->/)[0].replace('<!-- TRAINING / LEARNING HUB -->', '');
fs.writeFileSync('jobs.html', fixLinks(layoutStart + jobsData1 + jobsData2 + layoutEnd));
console.log('Created jobs.html');

// 3. CREATE training.html
const trainingData1 = html.match(/<!-- TRAINING \/ LEARNING HUB -->[\s\S]*?<!-- INTERNSHIP \/ APPRENTICESHIP -->/)[0].replace('<!-- INTERNSHIP / APPRENTICESHIP -->', '');
const trainingData2 = html.match(/<!-- INTERNSHIP \/ APPRENTICESHIP -->[\s\S]*?<!-- SUCCESS STORIES -->/)[0].replace('<!-- SUCCESS STORIES -->', '');
fs.writeFileSync('training.html', fixLinks(layoutStart + trainingData1 + trainingData2 + layoutEnd));
console.log('Created training.html');

// 4. CREATE login.html
const modalData = html.match(/<!-- REGISTRATION MODAL -->[\s\S]*?<\/div>[\s\r\n]*<\/div>[\s\r\n]*<\/div>/);
if (modalData) {
    let loginBody = `
  <!-- LOGIN SECTION -->
  <section class="login-section" style="background:var(--off-white); min-height:80vh; display:flex; align-items:center; justify-content:center; padding: 40px 1.5rem;">
    <div style="background:white; border-radius:var(--radius-lg); width:100%; max-width:500px; padding:30px; box-shadow:var(--shadow-md); border:1.5px solid var(--gray-200);">
        <h2 style="text-align:center; font-family:'Baloo 2',sans-serif; color:var(--blue-dark); margin-bottom:24px;">Join BluKaam Connection</h2>
        <!-- Registration Content Injected -->
        ${modalData[0].substring(modalData[0].indexOf('<div class="role-selector"'))}
    </div>
  </section>`;
    // Fix submit button margin
    loginBody = loginBody.replace('</form>', '\n        </form>');
    loginBody = loginBody.replace('</div>\r\n    </div>\r\n  </div>', ''); // remove outer modal divs
    fs.writeFileSync('login.html', fixLinks(layoutStart + loginBody + layoutEnd));
    console.log('Created login.html');
}

// 5. UPDATE index.html
let indexFix = html;
// Replace hero links
indexFix = indexFix.replace('href="#worker-profile"', 'href="login.html"');
indexFix = indexFix.replace('href="#contractor"', 'href="login.html"');

indexFix = fixLinks(indexFix);

// Remove the extracted sections from index.html (Workers, Worker Profile, Jobs, Contractor, Training, Internship)
indexFix = indexFix.replace(/<!-- WORKER PROFILES BROWSE -->[\s\S]*?<!-- SUCCESS STORIES -->/, '<!-- SUCCESS STORIES -->');
// Remove Registration Modal
indexFix = indexFix.replace(/<!-- REGISTRATION MODAL -->[\s\S]*?<\/div>[\s\r\n]*<\/div>[\s\r\n]*<\/div>/, '');

fs.writeFileSync('index.html', indexFix);
console.log('Updated index.html');
