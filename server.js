import express from "express";
import cors from "cors";
import fs from "fs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import path from "path";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

const PORT = 3000;
const SCHEDULES_FILE = path.join(process.cwd(), "schedules.json");

// 🗂️ Load schedules
let schedules = [];
try {
  if (fs.existsSync(SCHEDULES_FILE)) {
    const data = fs.readFileSync(SCHEDULES_FILE, "utf-8");
    schedules = JSON.parse(data || "[]");
    console.log(`📅 Loaded ${schedules.length} schedules.`);
  } else {
    console.log("⚠️ No schedules.json found, starting empty.");
  }
} catch (e) {
  console.error("❌ Failed to load schedules.json:", e.message);
  schedules = [];
}

// 📤 Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 📩 Generic email sender
async function sendEmail({ email, subject, text, html }) {
  if (!email) throw new Error("No email provided");
  return transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject,
    text,
    html,
  });
}

// 📅 Add a new schedule
app.post("/addSchedule", (req, res) => {
  let schedule = req.body;

  if (schedule.name && !schedule.medicineName) {
    schedule.medicineName = schedule.name;
  }

  if (!schedule || !schedule.email || !schedule.medicineName) {
    console.log("❌ Invalid schedule payload received.");
    return res.status(400).json({ error: "Invalid schedule payload" });
  }

  schedule.id = "sched_" + Math.random().toString(36).slice(2, 9);
  schedules.push(schedule);

  try {
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
    console.log(`📅 New schedule added for ${schedule.medicineName}`);
    res.json({ success: true, message: "✅ Schedule added successfully!", schedule });
  } catch (e) {
    console.error("❌ Failed to save schedules.json:", e.message);
    res.status(500).json({ error: "Failed to save schedule." });
  }
});

// 📥 Log a dose (taken or missed)
app.post("/logDose", (req, res) => {
  const log = req.body;
  if (!log || !log.medicineId || !log.status || !log.takenAt) {
    return res.status(400).json({ error: "Invalid dose log payload" });
  }

  const DOSE_LOGS_FILE = path.join(process.cwd(), "doseLogs.json");
  let existing = [];
  try {
    if (fs.existsSync(DOSE_LOGS_FILE)) {
      existing = JSON.parse(fs.readFileSync(DOSE_LOGS_FILE, "utf-8") || "[]");
    }
  } catch (e) {
    console.warn("⚠️ Could not read doseLogs.json:", e.message);
  }

  existing.push(log);

  try {
    fs.writeFileSync(DOSE_LOGS_FILE, JSON.stringify(existing, null, 2));
    console.log(`📦 Logged dose: ${log.medicineName} (${log.status})`);
    res.json({ success: true, message: "Dose logged successfully." });
  } catch (e) {
    console.error("❌ Failed to save dose log:", e.message);
    res.status(500).json({ error: "Failed to save dose log." });
  }
});

// 📤 Manual email trigger
app.post("/sendEmail", async (req, res) => {
  const { email, medicineName, status, time } = req.body;
  if (!email || !medicineName || !status) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    await sendEmail({
      email,
      subject: `💊 Dose Update: ${medicineName}`,
      text: `Your dose status: ${status} at ${time || new Date().toLocaleTimeString()}`,
      html: `<p>Status for <strong>${medicineName}</strong>: <strong>${status}</strong> at ${time || new Date().toLocaleTimeString()}</p>`,
    });
    console.log(`📨 Email sent (${status}): ${medicineName}`);
    res.json({ success: true });
  } catch (e) {
    console.error("❌ Failed to send email:", e.message);
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.get("/doseLogs", (req, res) => {
  const DOSE_LOGS_FILE = path.join(process.cwd(), "doseLogs.json");
  if (fs.existsSync(DOSE_LOGS_FILE)) {
    const logs = JSON.parse(fs.readFileSync(DOSE_LOGS_FILE, "utf-8"));
    res.json(logs);
  } else {
    res.json([]);
  }
});

// ✅ Reminder: runs every 30 sec, sends email ±30 sec of dose time
function checkDueSchedules() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  schedules.forEach((sched) => {
    if (!sched.time) return;

    const [h, m] = sched.time.split(":").map(Number);
    const doseTime = new Date(today);
    doseTime.setHours(h, m, 0, 0);

    const diff = doseTime - now;

    if (Math.abs(diff) < 30 * 1000) {
      sendEmail({
        email: sched.email,
        subject: `💊 Reminder: ${sched.medicineName}`,
        text: `It's time to take ${sched.medicineName} (${sched.dosage || ""}).`,
        html: `<p>It's time to take <strong>${sched.medicineName}</strong> (${sched.dosage || ""}).</p>`,
      })
        .then(() => console.log(`⏰ Reminder email sent for ${sched.medicineName}`))
        .catch((e) => console.error("❌ Reminder email failed:", e.message));
    }
  });
}
setInterval(checkDueSchedules, 30 * 1000);

// ❌ Auto mark as missed after 30 min if not taken
let doseLogs = [];
function autoMarkMissedDoses() {
  const now = new Date();
  const today = now.toDateString();

  const DOSE_LOGS_FILE = path.join(process.cwd(), "doseLogs.json");
  if (fs.existsSync(DOSE_LOGS_FILE)) {
    doseLogs = JSON.parse(fs.readFileSync(DOSE_LOGS_FILE, "utf-8") || "[]");
  }

  schedules.forEach((sched) => {
    if (!sched.time) return;

    const [h, m] = sched.time.split(":").map(Number);
    const doseTime = new Date();
    doseTime.setHours(h, m, 0, 0);

    // ✅ Mark as missed if 30 min have passed
    if (now - doseTime > 30 * 60 * 1000 && now - doseTime < 24 * 60 * 60 * 1000) {
      const alreadyLogged = doseLogs.some(
        (log) =>
          log.medicineName === sched.medicineName && // ✅ match by name
          new Date(log.takenAt).toDateString() === today &&
          log.status === "missed"
      );

      if (!alreadyLogged) {
        const missedLog = {
          id: "log_" + Math.random().toString(36).slice(2, 10),
          medicineId: sched.medicineName, // ✅ use name to match frontend logs
          medicineName: sched.medicineName,
          email: sched.email,
          status: "missed",
          takenAt: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          synced: false,
        };

        doseLogs.push(missedLog);
        console.log(`❌ Auto-marked missed: ${sched.medicineName}`);

        sendEmail({
          email: sched.email,
          subject: `⚠️ Missed Dose: ${sched.medicineName}`,
          text: `You missed your scheduled dose of ${sched.medicineName}.`,
          html: `<p>You missed your scheduled dose of <strong>${sched.medicineName}</strong>.</p>`,
        }).catch((e) => console.error("❌ Auto missed email failed:", e.message));
      }
    }
  });

  fs.writeFileSync(DOSE_LOGS_FILE, JSON.stringify(doseLogs, null, 2));
}

setInterval(autoMarkMissedDoses, 5 * 60 * 1000);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log("✅ Email notifications enabled.");
});
