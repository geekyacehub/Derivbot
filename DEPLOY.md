# Deploy DerivBot Pro X to Render (Free)

Your site is a **static site** (no build step, no backend) — Render deploys it in ~2 minutes on the free tier.

## Option A — Blueprint (fastest, 1 click after connect)

1. Push this repo to GitHub (already done — branch `arena/55f7f22f-derivbot`)
2. Go to [Render Dashboard](https://dashboard.render.com/) → sign up / log in (free)
3. Click **New → Blueprint**
4. Connect GitHub → select **`geekyacehub/Derivbot`**
5. Render reads `render.yaml` automatically → click **Apply**
6. Wait ~1 minute → your site is live at `https://derivbot-pro-x.onrender.com` (Render picks the name)

## Option B — Manual Static Site

1. Render Dashboard → **New → Static Site**
2. Connect GitHub → select **`geekyacehub/Derivbot`**
3. Fill in:
   - **Name:** `derivbot-pro-x`
   - **Branch:** `arena/55f7f22f-derivbot` (or `main` after you merge)
   - **Build Command:** *(leave empty)*
   - **Publish Directory:** `.`
4. Click **Create Static Site** → live in ~1 minute

## After deploy

- Open your new `https://derivbot-pro-x.onrender.com` URL
- Click **Connect Deriv** in the left sidebar
- Paste your Deriv API Token → **Connect & Authorize**
- Done — trade from anywhere, on any device

## Notes

- **Free tier:** Render static sites are free forever. No credit card needed.
- **Custom domain (optional):** Render → your service → Settings → Custom Domains → add your own domain.
- **Auto-deploy:** Every `git push` to the branch auto-deploys the new version.
- **No environment variables needed** — the Deriv App ID (`1089`) and your token are entered in the browser UI, not on the server.
- **HTTPS:** Render gives you free HTTPS automatically — required for the Deriv WebSocket connection.

## Alternative free hosts (same 3 files)

- **GitHub Pages:** Repo → Settings → Pages → Deploy from branch
- **Netlify:** Drag & drop the folder at [app.netlify.com/drop](https://app.netlify.com/drop)
- **Vercel:** `npx vercel` in the folder
