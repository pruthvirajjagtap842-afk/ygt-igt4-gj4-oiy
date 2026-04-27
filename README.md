# 🛡️ campro — Full Stack Deployment Guide

AI-Powered Interview Integrity Platform  
**Stack:** Node.js + Express · Agora RTC · Firebase Realtime DB · Firestore · Railway / Render

---

## Project Structure

```
campro/
├── server.js          ← Express backend (token server + REST API)
├── package.json
├── .env.example       ← Copy to .env and fill in your keys
├── railway.toml       ← Railway deployment config
├── render.yaml        ← Render deployment config (alternative)
├── .gitignore
├── public/
│   └── index.html     ← Frontend (auto-served by Express)
└── models/            ← face-api.js model files (see step 3)
```

---

## Step 1 — Get Your API Keys

### Agora (Video Calling)
1. Go to [console.agora.io](https://console.agora.io) → Create a project
2. Copy your **App ID**
3. In the project settings, enable **App Certificate** (for production token security)
4. Copy the **App Certificate**

### Firebase (Realtime sync + Firestore reports)
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project (or use your existing `campro-3c83d` project)
3. **Realtime Database**: Enable it (Start in test mode for now)
4. **Firestore Database**: Enable it
5. Go to **Project Settings → Your apps** → copy the web SDK config
6. Go to **Project Settings → Service accounts → Generate new private key**
   - Download the JSON file — you'll need it for `FIREBASE_SERVICE_ACCOUNT`

---

## Step 2 — Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in every value:

```env
PORT=3000

AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_agora_app_certificate   # leave blank for dev

FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...

# Paste the downloaded service account JSON as a single minified line:
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}
```

> **Tip for `FIREBASE_SERVICE_ACCOUNT`:** Open the downloaded JSON, minify it  
> (e.g. `cat serviceAccount.json | jq -c .`) and paste the result as one line.

---

## Step 3 — Download face-api.js Models

The models folder must sit inside `public/models/` so the browser can fetch them.

```bash
mkdir -p public/models
cd public/models

# Download the 3 required model files:
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-shard1
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_model-shard1
```

---

## Step 4 — Run Locally

```bash
npm install
npm run dev        # uses nodemon for auto-reload
# or
npm start          # production mode
```

Open → [http://localhost:3000](http://localhost:3000)

Check the API health → [http://localhost:3000/health](http://localhost:3000/health)

---

## Step 5 — Deploy to Railway (Recommended)

Railway gives you a free tier, automatic HTTPS, and one-click deploys.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init          # creates a new Railway project
railway up            # deploys your code
```

Then in the **Railway dashboard**:
1. Go to your service → **Variables** tab
2. Add every variable from your `.env` file one by one
3. Railway will auto-redeploy. Your live URL is shown in the dashboard.

**Or deploy via GitHub:**
1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo → Add variables in the Variables tab → Deploy

---

## Step 6 — Deploy to Render (Alternative)

```bash
# Push to GitHub first, then:
# 1. Go to render.com → New Web Service
# 2. Connect your GitHub repo
# 3. Render auto-detects render.yaml
# 4. Add your environment variables in the dashboard
# 5. Click Deploy
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health + Firestore/Agora status |
| GET | `/api/config` | Returns Agora App ID + Firebase config for frontend |
| GET | `/api/token?channel=ROOM&uid=0` | Generate a signed Agora RTC token |
| POST | `/api/sessions` | Create / upsert a session record |
| GET | `/api/sessions/:meetingId` | Get a session |
| POST | `/api/reports` | Save a completed interview report |
| GET | `/api/reports/:meetingId` | Get reports for a session |
| GET | `/api/reports` | List all recent reports |

---

## Firestore Collections

| Collection | Description |
|------------|-------------|
| `sessions` | One document per Meeting ID, tracks active/ended status |
| `reports` | Full interview report saved on session end |

Firebase Realtime Database is still used for **live sync** (trust score, alerts) between interviewer and candidate during the session — exactly as before.

---

## Firebase Security Rules (Recommended)

**Realtime Database** — paste in Firebase console → Realtime Database → Rules:
```json
{
  "rules": {
    "campro_sessions": {
      "$sessionId": {
        ".read":  true,
        ".write": true
      }
    }
  }
}
```

**Firestore** — paste in Firebase console → Firestore → Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      allow read, write: if true;
    }
    match /reports/{reportId} {
      allow read, write: if true;
    }
  }
}
```
> Lock these down further once you add authentication.

---

## What Changed From the Prototype

| Before (prototype) | After (production) |
|---|---|
| Agora App ID hardcoded in HTML | Fetched securely from `/api/config` |
| No Agora token (null) | Signed RTC token from `/api/token` |
| Firebase credentials hardcoded | Loaded from backend env vars |
| Reports only exported as `.txt` | Auto-saved to Firestore on session end |
| Sessions not persisted | Session state tracked in Firestore |
| No server | Express server with REST API |
| Needs a static file server | Self-contained — Express serves everything |

---

## Troubleshooting

**Models not loading (face-api.js fails)**  
→ Make sure model files are in `public/models/` (not just `models/`)

**Agora join fails**  
→ Check `/health` to confirm `AGORA_APP_ID` is set. Check browser console for the error.

**Firebase sync not working**  
→ Confirm `FIREBASE_DATABASE_URL` is correct and Realtime Database rules allow write.

**Firestore reports not saving**  
→ Check `FIREBASE_SERVICE_ACCOUNT` is valid JSON (minified, single line). Check `/health` for `"firestore": true`.
