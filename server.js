// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');

const app = express();
app.use(cors());
app.use(express.json());

const SCHEDULE_FILE = path.join(__dirname, 'schedules.json');
const LAST_SENT_FILE = path.join(__dirname, 'lastSent.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file)); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let schedules = readJSON(SCHEDULE_FILE, []);
let lastSent = readJSON(LAST_SENT_FILE, {});

// Nodemailer transporter (configurable via .env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
  secure: (process.env.SMTP_PORT ? process.env.SMTP_PORT === '465' : true),
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Basic verification on start
transporter.verify((err, success) => {
  if (err) console.warn('⚠️ SMTP verify failed:', err.message);
  else console.log('✅ SMTP ready');
});

// Add schedule endpoint
app.post('/addSchedule', (req, res) => {
  const {
    medicineName, dosage = '', time, frequency = 'onceDaily',
    duration = 7, email, startDate, timezone
  } = req.body;

  if (!medicineName || !time || !email) {
    return res.status(400).json({ error: 'medicineName, time and email are required' });
  }

  const id = Date.now().toString();
  const tz = timezone || process.env.SERVER_TIMEZONE || 'UTC';
  const schedule = {
    id, medicineName, dosage, time, frequency,
    duration: parseInt(duration, 10),
    email,
    startDate: startDate || DateTime.now().setZone(tz).toISODate(),
    timezone: tz,
    createdAt: new Date().toISOString()
  };

  schedules.push(schedule);
  writeJSON(SCHEDULE_FILE, schedules);
  return res.json({ success: true, schedule });
});

// List schedules (for debugging)
app.get('/schedules', (req, res) => res.json(schedules));

// Remove schedule
app.delete('/schedules/:id', (req, res) => {
  const id = req.params.id;
  schedules = schedules.filter(s => s.id !== id);
  writeJSON(SCHEDULE_FILE, schedules);
  res.json({ success: true });
});

// Utility: is now within this schedule's duration window?
function isWithinDuration(schedule, now) {
  const start = DateTime.fromISO(schedule.startDate, { zone: schedule.timezone }).startOf('day');
  const end = start.plus({ days: schedule.duration - 1 }).endOf('day');
  return now >= start.startOf('day') && now <= end;
}

// Main checker (run each minute)
function checkDueSchedules() {
  const nowUTC = DateTime.utc();

  schedules.forEach(schedule => {
    const tz = schedule.timezone || process.env.SERVER_TIMEZONE || 'UTC';
    const now = DateTime.now().setZone(tz).startOf('minute');

    // skip if outside duration
    if (!isWithinDuration(schedule, now)) return;

    const [hStr, mStr] = (schedule.time || '00:00').split(':');
    const baseToday = now.set({ hour: parseInt(hStr, 10), minute: parseInt(mStr, 10), second: 0, millisecond: 0 });

    const candidates = [];

    switch (schedule.frequency) {
      case 'onceDaily':
        candidates.push(baseToday);
        break;
      case 'twiceDaily':
        candidates.push(baseToday, baseToday.plus({ hours: 12 }));
        break;
      case 'every8h':
        candidates.push(baseToday, baseToday.plus({ hours: 8 }), baseToday.plus({ hours: 16 }));
        break;
      case 'everyOtherDay': {
        const start = DateTime.fromISO(schedule.startDate, { zone: tz }).startOf('day');
        const daysDiff = Math.floor(now.startOf('day').diff(start, 'days').days);
        if (daysDiff >= 0 && (daysDiff % 2 === 0)) candidates.push(baseToday);
        break;
      }
      case 'weekly': {
        const start = DateTime.fromISO(schedule.startDate, { zone: tz }).startOf('day');
        const daysDiff = Math.floor(now.startOf('day').diff(start, 'days').days);
        if (daysDiff >= 0 && (daysDiff % 7 === 0)) candidates.push(baseToday);
        break;
      }
      default:
        candidates.push(baseToday);
    }

    candidates.forEach(dt => {
      // only send when candidate minute equals now
     if (dt.toFormat("HH:mm") !== now.toFormat("HH:mm")) return;


      const minuteKey = now.toISO(); // unique minute key in schedule's timezone
      if (lastSent[schedule.id] === minuteKey) return; // already sent this minute

      // prepare email
      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: schedule.email,
        subject: `⏰ Time to take ${schedule.medicineName}`,
        text: `It's time to take ${schedule.medicineName} ${schedule.dosage ? `(${schedule.dosage})` : ''}.\n\nTake care!`,
        html: `<p>It's time to take <strong>${schedule.medicineName}</strong> ${schedule.dosage ? `(${schedule.dosage})` : ''}.</p>`
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          console.error('❌ Email error for', schedule.email, err.message);
        } else {
          console.log(`📨 Email sent to ${schedule.email} for ${schedule.medicineName} (${minuteKey})`);
          lastSent[schedule.id] = minuteKey;
          writeJSON(LAST_SENT_FILE, lastSent);
        }
      });
    });
  });
}

// run immediately and every minute
checkDueSchedules();
setInterval(checkDueSchedules, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Email scheduler running on port ${PORT}`));
