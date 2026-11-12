# HatsApp

Wear many WhatsApp hats. One window, instant switching, unified notifications.

- Add as many accounts as you need
- Click to switch instantly
- Each account keeps its own session
- Desktop notifications are prefixed with the account name
- Closes to the Windows system tray
- Packaged builds can auto-update without wiping logins

## Run (development)

```bash
npm install
npm start
```

## Use

1. Enter an account name and click **Add**
2. Scan the WhatsApp QR code
3. Repeat for more accounts
4. Switch from the left sidebar

Clicking a unified notification focuses that account and opens the chat when possible.

Logins and account list are stored in `%APPDATA%\hatsapp`, not inside the project folder. Updating the app code or installing a newer build keeps those sessions.

## Build an installer for your friend

```bash
npm install
npm run dist
```

Installer output:

`release/HatsApp-Setup-1.0.0.exe`

Send that Setup file once. Your friend installs it like a normal Windows app.

## Auto-update pipeline

1. Create a GitHub repo for HatsApp
2. Put the repo URL in `package.json` → `repository.url` (replace `OWNER/HatsApp`)
3. Push the code
4. Ship a version:

```bash
npm version patch
git push
git push --tags
```

Tag format must be `v1.0.1` style. The GitHub Action builds Windows and publishes a Release. Installed copies check for updates on launch and every few hours. When an update is ready, HatsApp offers restart. AppData logins stay put.

Manual publish from your PC (needs `GH_TOKEN` with repo release access):

```bash
npm version patch
npm run release
```
