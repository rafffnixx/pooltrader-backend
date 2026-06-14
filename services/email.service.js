const axios = require('axios');

class EmailService {
    constructor() {
        this.useRealEmail = process.env.USE_REAL_EMAIL === 'true';
        this.webhookUrl = process.env.APPS_SCRIPT_URL;
        
        console.log('\n📧 Email Service Configuration:');
        console.log(`   USE_REAL_EMAIL: ${this.useRealEmail}`);
        console.log(`   APPS_SCRIPT_URL: ${this.webhookUrl ? '✓ Configured' : '✗ Not configured'}`);
        console.log('');
    }

    async sendEmail(recipient, type, data) {
        try {
            const templates = this.getEmailTemplates();
            const template = templates[type];
            
            if (!template) {
                console.error(`❌ No template found for type: ${type}`);
                return false;
            }
            
            let emailSubject = template.subject;
            let emailBody = template.body;
            
            // Replace variables in templates
            if (data) {
                for (const [key, value] of Object.entries(data)) {
                    const regex = new RegExp(`{{${key}}}`, 'g');
                    emailSubject = emailSubject.replace(regex, value);
                    emailBody = emailBody.replace(regex, value);
                }
            }
            
            const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3001';
            emailBody = emailBody.replace(/{{frontendUrl}}/g, frontendUrl);
            emailBody = emailBody.replace(/{{loginUrl}}/g, `${frontendUrl}/login`);
            emailBody = emailBody.replace(/{{dashboardUrl}}/g, `${frontendUrl}/dashboard`);
            
            if (this.useRealEmail && this.webhookUrl) {
                try {
                    const response = await axios.post(this.webhookUrl, {
                        recipient: recipient,
                        subject: emailSubject,
                        body: emailBody,
                        type: type
                    });
                    console.log(`✅ Email sent to ${recipient}: ${type}`);
                    return response.data?.success !== false;
                } catch (axiosError) {
                    console.error(`❌ Failed to send email via webhook: ${axiosError.message}`);
                    this.logToConsole(recipient, emailSubject, emailBody, type);
                    return false;
                }
            } else {
                this.logToConsole(recipient, emailSubject, emailBody, type);
                return true;
            }
        } catch (error) {
            console.error(`❌ Failed to process email:`, error.message);
            return false;
        }
    }

    logToConsole(recipient, subject, body, type) {
        console.log('\n' + '='.repeat(60));
        console.log(`📧 EMAIL [${type.toUpperCase()}]`);
        console.log('='.repeat(60));
        console.log(`To: ${recipient}`);
        console.log(`Subject: ${subject}`);
        console.log(`Body Preview: ${body.substring(0, 300)}...`);
        console.log('='.repeat(60) + '\n');
    }

    getEmailTemplates() {
        return {
            // ==================== EMAIL VERIFICATION ====================
            'email_verification': {
                subject: '✓ Verify Your Email - PoolTrader',
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Verify Your Email</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f5; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                            .header { background: linear-gradient(135deg, #3b82f6, #9333ea); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0; }
                            .header h1 { color: white; margin: 0; font-size: 28px; }
                            .content { padding: 40px 30px; background: #ffffff; }
                            .code { font-size: 48px; font-weight: bold; text-align: center; letter-spacing: 10px; color: #3b82f6; margin: 30px 0; font-family: monospace; }
                            .button { display: inline-block; padding: 14px 28px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                            .warning { background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
                        </style>
                    </head>
                    <body style="margin: 0; padding: 20px; background-color: #f4f4f5;">
                        <div class="container">
                            <div class="header">
                                <h1>PoolTrader</h1>
                            </div>
                            <div class="content">
                                <h2>Hello {{name}}!</h2>
                                <p>Thank you for registering with PoolTrader! Please verify your email address to start your trading journey.</p>
                                <div class="code">{{verificationCode}}</div>
                                <div style="text-align: center;">
                                    <a href="{{verificationLink}}" class="button">Verify Email Address</a>
                                </div>
                                <p>Or copy and paste this link:</p>
                                <p style="word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 6px; font-size: 12px;">{{verificationLink}}</p>
                                <p>Or enter this code manually: <strong>{{verificationCode}}</strong></p>
                                <div class="warning">
                                    <strong>⚠️ Important:</strong> This verification code expires in {{expiryHours}} hours.
                                </div>
                                <p>If you didn't create an account with PoolTrader, please ignore this email.</p>
                                <p>Best regards,<br>The PoolTrader Team</p>
                            </div>
                            <div class="footer">
                                <p>&copy; 2024 PoolTrader. All rights reserved.</p>
                                <p>This is an automated message, please do not reply.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            },

            // ==================== WELCOME EMAIL (After Verification) ====================
            'welcome': {
                subject: '🎉 Welcome to PoolTrader!',
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Welcome to PoolTrader</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 20px; }
                            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                            .header { background: linear-gradient(135deg, #10b981, #059669); padding: 40px 30px; text-align: center; }
                            .header h1 { color: white; margin: 0; }
                            .content { padding: 40px 30px; }
                            .button { display: inline-block; padding: 14px 28px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                            .steps { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Welcome to PoolTrader! 🎉</h1>
                            </div>
                            <div class="content">
                                <h2>Hello {{name}},</h2>
                                <p>Thank you for verifying your email! Your account is now active and ready to trade.</p>
                                <div class="steps">
                                    <h3>📋 Getting Started:</h3>
                                    <ol style="margin: 0; padding-left: 20px;">
                                        <li>Make your first deposit to fund your wallet</li>
                                        <li>Browse active trading pools</li>
                                        <li>Invest in pools that match your goals</li>
                                        <li>Watch your investments grow</li>
                                    </ol>
                                </div>
                                <div style="text-align: center;">
                                    <a href="{{dashboardUrl}}" class="button">Go to Dashboard</a>
                                </div>
                                <p>Need help? Contact our support team anytime.</p>
                                <p>Best regards,<br>The PoolTrader Team</p>
                            </div>
                            <div class="footer">
                                <p>&copy; 2024 PoolTrader. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            },

            // ==================== PASSWORD RESET REQUEST ====================
            'password_reset': {
                subject: '🔐 Reset Your PoolTrader Password',
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Reset Password</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 20px; }
                            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; }
                            .header { background: linear-gradient(135deg, #3b82f6, #9333ea); padding: 40px 30px; text-align: center; }
                            .header h1 { color: white; margin: 0; }
                            .content { padding: 40px 30px; }
                            .button { display: inline-block; padding: 14px 28px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
                            .warning { background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Reset Your Password</h1>
                            </div>
                            <div class="content">
                                <h2>Hello {{name}},</h2>
                                <p>We received a request to reset your password for your PoolTrader account.</p>
                                <div style="text-align: center;">
                                    <a href="{{resetLink}}" class="button">Reset Password</a>
                                </div>
                                <p>Or copy this link:</p>
                                <p style="word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 6px; font-size: 12px;">{{resetLink}}</p>
                                <div class="warning">
                                    <strong>⚠️ Security Alert:</strong> This link will expire in 1 hour. If you didn't request this, please ignore this email.
                                </div>
                                <p>Best regards,<br>The PoolTrader Team</p>
                            </div>
                            <div class="footer">
                                <p>&copy; 2024 PoolTrader. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            },

            // ==================== PASSWORD RESET CONFIRMATION ====================
            'password_reset_confirmation': {
                subject: '✓ Password Reset Successful - PoolTrader',
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Password Reset Successful</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 20px; }
                            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; }
                            .header { background: linear-gradient(135deg, #10b981, #059669); padding: 40px 30px; text-align: center; }
                            .header h1 { color: white; margin: 0; }
                            .content { padding: 40px 30px; }
                            .button { display: inline-block; padding: 14px 28px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Password Reset Successful</h1>
                            </div>
                            <div class="content">
                                <h2>Hello {{name}},</h2>
                                <p>Your password has been successfully reset.</p>
                                <div style="text-align: center;">
                                    <a href="{{loginUrl}}" class="button">Login Now</a>
                                </div>
                                <p>If you did not perform this action, please contact support immediately.</p>
                                <p>Best regards,<br>The PoolTrader Team</p>
                            </div>
                            <div class="footer">
                                <p>&copy; 2024 PoolTrader. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            },

            // ==================== PASSWORD CHANGED NOTIFICATION ====================
            'password_changed': {
                subject: '✓ Password Changed - PoolTrader',
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Password Changed</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 20px; }
                            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; }
                            .header { background: linear-gradient(135deg, #f59e0b, #d97706); padding: 40px 30px; text-align: center; }
                            .header h1 { color: white; margin: 0; }
                            .content { padding: 40px 30px; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Password Changed</h1>
                            </div>
                            <div class="content">
                                <h2>Hello {{name}},</h2>
                                <p>Your password has been changed successfully.</p>
                                <p>If you did not make this change, please contact support immediately.</p>
                                <p>Best regards,<br>The PoolTrader Team</p>
                            </div>
                            <div class="footer">
                                <p>&copy; 2024 PoolTrader. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            },

            // ==================== ADMIN PASSWORD RESET ====================
            'admin_password_reset': {
                subject: '🔐 Your Password Has Been Reset - PoolTrader',
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Password Reset by Admin</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 20px; }
                            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; }
                            .header { background: linear-gradient(135deg, #ef4444, #dc2626); padding: 40px 30px; text-align: center; }
                            .header h1 { color: white; margin: 0; }
                            .content { padding: 40px 30px; }
                            .button { display: inline-block; padding: 14px 28px; background: #ef4444; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Password Reset by Admin</h1>
                            </div>
                            <div class="content">
                                <h2>Hello {{name}},</h2>
                                <p>An administrator ({{adminName}}) has reset your password.</p>
                                <div style="text-align: center;">
                                    <a href="{{loginUrl}}" class="button">Reset Password</a>
                                </div>
                                <p>Please use the "Forgot Password" link on the login page to set a new password.</p>
                                <p>Best regards,<br>The PoolTrader Team</p>
                            </div>
                            <div class="footer">
                                <p>&copy; 2024 PoolTrader. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            }
        };
    }
}

module.exports = new EmailService();