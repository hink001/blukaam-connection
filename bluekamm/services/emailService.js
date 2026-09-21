const nodemailer = require('nodemailer');

// Check if email credentials are configured in environment
const isEmailConfigured = () => {
    return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
};

// Create transporter lazily so env changes take effect
const getTransporter = () => {
    if (!isEmailConfigured()) return null;

    // Default to Gmail if SMTP_HOST not specified
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    // Gmail SMTP (Free 500 emails/day)
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

/**
 * Send 6-digit OTP verification email
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - 6-digit numeric OTP code
 * @param {string} userName - Optional user's name
 */
const sendOtpEmail = async (toEmail, otp, userName = 'Professional') => {
    const configured = isEmailConfigured();

    if (!configured) {
        console.log('\n======================================================');
        console.log('📧 BLUKAAM EMAIL OTP INTERCEPTED (Dev/Simulation Mode)');
        console.log(`To: ${toEmail}`);
        console.log(`Verification Code: ${otp}`);
        console.log('NOTE: To send real emails, set EMAIL_USER and EMAIL_PASS in bluekamm/.env');
        console.log('======================================================\n');

        return {
            success: true,
            simulated: true,
            devOtp: otp,
            message: 'OTP simulated (credentials not set in .env)'
        };
    }

    try {
        const transporter = getTransporter();
        const mailOptions = {
            from: `"BluKaam Connection" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: `🔐 Your BluKaam Verification Code: ${otp}`,
            html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 540px; margin: 0 auto; background: #ffffff; border: 1.5px solid #E2E8F0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(7,30,74,0.06);">
                <div style="background: linear-gradient(135deg, #071E4A 0%, #0284C7 100%); padding: 32px 24px; text-align: center; color: white;">
                    <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">BluKaam Connection</h1>
                    <p style="margin: 6px 0 0; font-size: 13px; color: #E0F2FE; letter-spacing: 1px; text-transform: uppercase;">Identity & Profile Verification</p>
                </div>
                
                <div style="padding: 32px 28px; text-align: center; color: #1E293B;">
                    <h2 style="margin-top: 0; font-size: 20px; font-weight: 700; color: #071E4A;">Verify Your Email Address</h2>
                    <p style="font-size: 15px; color: #475569; line-height: 1.5; margin-bottom: 24px;">
                        Hello <strong>${userName}</strong>, thank you for joining BluKaam Connection! Use the 6-digit verification code below to complete your profile registration.
                    </p>
                    
                    <div style="background: #F0F9FF; border: 2px dashed #0284C7; border-radius: 12px; padding: 18px 24px; display: inline-block; margin-bottom: 24px;">
                        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0284C7; font-family: monospace;">${otp}</span>
                    </div>

                    <p style="font-size: 13px; color: #94A3B8; margin: 0 0 16px;">
                        ⏱️ This verification code is valid for <strong>5 minutes</strong>.
                    </p>
                    <p style="font-size: 12px; color: #94A3B8; margin: 0;">
                        If you did not request this verification, please ignore this email or contact support.
                    </p>
                </div>

                <div style="background: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 18px 24px; text-align: center; font-size: 12px; color: #64748B;">
                    &copy; ${new Date().getFullYear()} BluKaam Connection &bull; India's Blue-Collar Digital Workforce Network
                </div>
            </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[Email Service] OTP email sent successfully to ${toEmail} (Message ID: ${info.messageId})`);
        return { success: true, simulated: false, messageId: info.messageId };
    } catch (err) {
        console.error('[Email Service Error] Failed to send email via SMTP:', err.message);
        // Fail over to simulation mode if SMTP rejects credentials so the user isn't completely locked out
        return {
            success: true,
            simulated: true,
            devOtp: otp,
            warning: 'SMTP delivery failed (' + err.message + '). Dev OTP provided.'
        };
    }
};

module.exports = {
    isEmailConfigured,
    sendOtpEmail
};
