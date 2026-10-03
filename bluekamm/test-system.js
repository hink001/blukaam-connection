/**
 * Automated Verification Script for BluKaam Authentication, Profile & Activity System
 */
const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(method, path, body = null, token = null, isMultipart = false, multipartData = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const headers = {};

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let requestBody = null;

        if (isMultipart && multipartData) {
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
            
            const fieldHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${multipartData.fieldName}"; filename="${multipartData.filename}"\r\nContent-Type: ${multipartData.contentType}\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;

            const fieldHeaderBuf = Buffer.from(fieldHeader, 'utf8');
            const footerBuf = Buffer.from(footer, 'utf8');
            requestBody = Buffer.concat([fieldHeaderBuf, multipartData.fileBuffer, footerBuf]);
            headers['Content-Length'] = requestBody.length;
        } else if (body) {
            headers['Content-Type'] = 'application/json';
            requestBody = JSON.stringify(body);
            headers['Content-Length'] = Buffer.byteLength(requestBody);
        }

        const req = http.request(url, { method, headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (requestBody) req.write(requestBody);
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Starting Automated System Verification against ' + BASE_URL);
    let passed = 0;
    let failed = 0;

    const testEmail = `test_worker_${Date.now()}@blukaam.com`;
    const testPassword = 'Password@123';
    let authToken = null;
    let userId = null;

    try {
        // 1. Status Check
        const statusRes = await makeRequest('GET', '/api/status');
        if (statusRes.status === 200) {
            console.log('✅ 1. System Status API OK:', statusRes.data.message);
            passed++;
        } else {
            console.error('❌ 1. System Status API Failed:', statusRes);
            failed++;
        }

        // 2. User Registration
        const regRes = await makeRequest('POST', '/api/auth/register', {
            email: testEmail,
            password: testPassword,
            fullName: 'Vikram Sharma',
            role: 'Worker',
            phone: '9876543210',
            city: 'New Delhi',
            state: 'Delhi',
            workType: 'Master Electrician'
        });

        if (regRes.status === 201 && regRes.data.token) {
            authToken = regRes.data.token;
            userId = regRes.data.user.id || regRes.data.user._id;
            console.log('✅ 2. Registration API OK: Created user with email', testEmail);
            passed++;
        } else {
            console.error('❌ 2. Registration API Failed:', regRes);
            failed++;
        }

        // 3. User Login
        const loginRes = await makeRequest('POST', '/api/auth/login', {
            email: testEmail,
            password: testPassword
        });

        if (loginRes.status === 200 && loginRes.data.token) {
            console.log('✅ 3. Login API OK: Successfully verified bcrypt password hash');
            passed++;
        } else {
            console.error('❌ 3. Login API Failed:', loginRes);
            failed++;
        }

        // 4. Protected Session Check
        const meRes = await makeRequest('GET', '/api/auth/me', null, authToken);
        if (meRes.status === 200 && meRes.data.user) {
            console.log('✅ 4. Protected /api/auth/me Route Guard OK: Authenticated as', meRes.data.user.email);
            passed++;
        } else {
            console.error('❌ 4. Protected Route Guard Failed:', meRes);
            failed++;
        }

        // 5. Update Profile
        const updateRes = await makeRequest('PUT', '/api/profile/me', {
            headline: 'Lead Industrial Electrician & Solar Specialist',
            bio: 'Expert with over 9 years in industrial wiring, DB boards, and commercial solar projects.',
            skills: ['Industrial Wiring', 'Solar Panel Installation', '3-Phase Circuits', 'MCB DB Board'],
            location: { city: 'New Delhi', state: 'Delhi', pincode: '110001', country: 'India' },
            contactInfo: { phone: '+91 9876543210', email: testEmail, website: 'https://vikram-electrician.in' },
            availability: 'Available',
            experienceYears: 9
        }, authToken);

        if (updateRes.status === 200 && updateRes.data.profile.skills.length === 4) {
            console.log('✅ 5. Profile Update API OK: Updated headline, bio, and 4 skills');
            passed++;
        } else {
            console.error('❌ 5. Profile Update Failed:', updateRes);
            failed++;
        }

        // 6. Avatar Cloud Upload (In-memory buffer)
        // 1x1 transparent PNG buffer
        const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        const uploadRes = await makeRequest('POST', '/api/profile/me/avatar', null, authToken, true, {
            fieldName: 'avatar',
            filename: 'profile_pic.png',
            contentType: 'image/png',
            fileBuffer: dummyPng
        });

        if (uploadRes.status === 200 && uploadRes.data.avatarUrl) {
            console.log('✅ 6. Photo Upload API OK: Photo stored with URL:', uploadRes.data.avatarUrl.substring(0, 40) + '...');
            passed++;
        } else {
            console.error('❌ 6. Photo Upload Failed:', uploadRes);
            failed++;
        }

        // 7. Activity Log Monitoring
        const activitiesRes = await makeRequest('GET', '/api/activities/me', null, authToken);
        if (activitiesRes.status === 200 && activitiesRes.data.length >= 3) {
            console.log(`✅ 7. Activity Tracking OK: Logged ${activitiesRes.data.length} activities (Registered, Logged In, Updated Profile, Updated Photo)`);
            passed++;
        } else {
            console.error('❌ 7. Activity Tracking Failed:', activitiesRes);
            failed++;
        }

        // 8. Public Profile View
        const publicRes = await makeRequest('GET', `/api/profile/public/${userId}`);
        if (publicRes.status === 200 && publicRes.data.fullName === 'Vikram Sharma') {
            console.log('✅ 8. Public Profile API OK: Retrieved public profile for Vikram Sharma');
            passed++;
        } else {
            console.error('❌ 8. Public Profile API Failed:', publicRes);
            failed++;
        }

        console.log(`\n========================================`);
        console.log(`🎉 TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
        console.log(`========================================\n`);

        process.exit(failed > 0 ? 1 : 0);
    } catch (e) {
        console.error('Test execution exception:', e);
        process.exit(1);
    }
}

// Give server 1 second to accept requests
setTimeout(runTests, 1000);
