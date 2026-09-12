# Phone-Tracher

## Run locally

```powershell
node server.js
```

Open `http://localhost:5173/` for the site or `http://localhost:5173/admin` for the admin dashboard.

## Deploy on Render

Create a new **Blueprint** in Render from this GitHub repository. Render will use `render.yaml` to start the public web service with `node server.js`.

The free Render filesystem is temporary, so `data.json` should not be treated as durable storage in production.

## Supabase storage

Run `supabase.sql` in the Supabase SQL Editor. In Render, set `SUPABASE_SERVICE_ROLE_KEY` to the server-only service-role key. Do not put this key in frontend JavaScript or commit it to GitHub.