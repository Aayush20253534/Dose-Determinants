require("dotenv").config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.sendMail({
  from: process.env.EMAIL_FROM,
  to: "thakur39aayush@gmail.com",
  subject: "Test Email from Node.js",
  text: "This is a test email."
}, (err, info) => {
  if (err) {
    console.error("❌ Failed to send:", err);
  } else {
    console.log("✅ Sent:", info.response);
  }
});
