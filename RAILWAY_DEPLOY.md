# Railway deployment – static assets (404 fix)

The app is a Django backend that serves a React frontend. The 404 on `/static/js/main.*.js` and `/static/css/main.*.css` happens when the React build and static collection are not run during deploy, so those files never exist on the server.

## What was added

1. **`build.sh`** – Builds the React app and runs Django’s `collectstatic` so WhiteNoise can serve the assets.
2. **`nixpacks.toml`** – For Nixpacks builds: installs Node, then runs `build.sh` in the build phase so `/static/` files are present at runtime.

## What you need to do

### If Railway uses Nixpacks (existing services)

Commit and push `build.sh` and `nixpacks.toml`. The next deploy should:

1. Install Node in the image.
2. Run `build.sh` (frontend build + `collectstatic`).
3. Serve `/static/` from `staticfiles/` via WhiteNoise.

Redeploy and test the app URL.

### If Railway uses Railpack (new services) or build still fails

Set the **build command** in the service so it runs the same steps:

1. In Railway: your service → **Settings** → **Build**.
2. Set **Build Command** to:
   ```bash
   chmod +x build.sh && ./build.sh
   ```
3. Ensure the build environment has Node (e.g. add Node via Railway’s build settings or use a Dockerfile if needed).
4. Redeploy.

After a successful build, `/static/js/main.*.js` and `/static/css/main.*.css` should load and the MIME type errors should stop.
