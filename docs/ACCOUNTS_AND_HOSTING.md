# Accounts and family rollout

Form uses Django's session cookies, password hashing, CSRF protection, and invite-only signup. Every tracker API requires an authenticated account. Lists, details, updates, deletes, nested references, photos, imports, and offline replay are scoped to that account; being an administrator does not widen tracker API access.

Each account has a separate IndexedDB database on the phone. Signing out keeps its drafts/cache in that account's storage, removes the remembered session, and reloads the interface. A later login to a different account cannot replay another account's queue. Sign-out asks the user to finish pending sync first. An expired server session stops sync without deleting pending saves; reconnect and sign in to resume. On a network outage the last signed-in account may reopen its own cached tracker, so anyone with access to an unlocked phone may access that cached data. Sign out before sharing a device. Account changes in another browser tab are detected through an account header before tracker requests execute.

## First rollout: preserve the existing tracker

1. Open the old app on the existing phone while connected. Wait for pending changes to reach zero. Keep its site data and installation.
2. Build and deploy with the existing Pi deployment script. The installer makes a database backup before migration. Copy that backup off the Pi as well. Do not publish the tunnel yet.
3. On the Pi, create the host's administrator and assign the old tracker **before its first login**. Run this in your own terminal; passwords are entered interactively, never placed in command arguments or chat:

   ```bash
   ssh -t pieme@100.74.89.59
   cd ~/fitnessapp
   set -a
   source ~/fitnessapp-data/fitnessapp.env
   set +a
   .venv/bin/python backend/manage.py createsuperuser --username kevin
   .venv/bin/python backend/manage.py claim_tracker kevin
   ```

   Choose an actual username rather than using `kevin` if desired. The explicit claim command assigns only unowned legacy records and preferences. It cannot reassign another account's tracker. It is safe to repeat for the same designated owner. Invitations and first-time signups never claim history.
4. Activate the app update and sign in on the original phone at the original address. Only the designated legacy owner imports the old on-device queue, cache, Notes draft, and active workout into their account's storage. The import is transactional, happens once per device, and preserves the original database as a recovery copy. New family accounts start empty.
5. In **Profile → Create family invitation**, generate and copy a one-use link. It expires in seven days. The recipient chooses a username and password. Only administrators can create invitations.

For local development, run migrations, `createsuperuser`, and optionally `claim_tracker` against the local database, then start the Django and Angular development servers. Local CSRF configuration supports `http://localhost:4200`; set `CSRF_TRUSTED_ORIGINS` for any other development origin.

## Password recovery

For this first family release the host resets forgotten passwords on the server using `.venv/bin/python backend/manage.py changepassword USERNAME` after loading the production environment. Django invalidates that account's old sessions. There is no email recovery service yet.

## A normal web address while keeping the Pi

A domain name does not require moving the server. For a family rollout, keep Django, the built Angular app, and SQLite on the Pi and connect a **Cloudflare Tunnel** to its existing loopback service:

```text
Family's phone → https://fitness.your-domain.example → Cloudflare Tunnel → Pi 127.0.0.1:8080
```

The domain above is an example, not a registered or configured address. Family members only open the HTTPS URL, sign in, and add it to their Home Screen. No Tailscale, VPN, or client tunnel software is needed for the published HTTP application. Tailscale can remain available to the host for private administration.

To publish:

1. Choose a domain you control and configure its DNS with Cloudflare. A persistent published tunnel hostname needs a domain; temporary Quick Tunnel addresses are for testing.
2. Install the `cloudflared` connector appropriate for the Pi's OS/architecture and run a named tunnel as a service that starts after reboot. Route the chosen public hostname to `http://127.0.0.1:8080`. The Pi remains bound to loopback; no router port forwarding is necessary.
3. In `~/fitnessapp-data/fitnessapp.env`, add the public hostname to `DJANGO_ALLOWED_HOSTS` and its full HTTPS origin to `CSRF_TRUSTED_ORIGINS`. Preserve the original Tailscale hostname/origin for private access. Example:

   ```dotenv
   DJANGO_ALLOWED_HOSTS=fitness.your-domain.example,raspberrypi.tail9c05f9.ts.net,localhost,127.0.0.1
   CSRF_TRUSTED_ORIGINS=https://fitness.your-domain.example,https://raspberrypi.tail9c05f9.ts.net:8443
   DJANGO_DEBUG=false
   CORS_ALLOWED_ORIGINS=
   ```

   Restart `fitnessapp.service`. The frontend and API use the same public origin, so cross-origin API access is unnecessary. The existing production deployment trusts HTTPS forwarding only because Gunicorn is reachable through local proxies on loopback. Keep that binding when changing hosting.
4. Bypass Cloudflare caching for `/api/*`, `/admin/*`, `/`, `/index.html`, `/ngsw.json`, `/ngsw-worker.js`, and `/update.html`; preserve the app's cache headers. API responses are `private, no-store`. Do not enable a broad "cache everything" rule over account data. Restrict or block the public `/admin/` route; administer it through the private hostname instead.
5. Configure login abuse protection at the edge. The app limits login/signup attempts to 10 per minute per connection address. Behind a local tunnel this is a shared conservative limit; do not blindly trust user-supplied forwarding headers. For larger use, introduce a verified client-IP policy and a shared rate-limit cache across workers.
6. Set up off-device backups and verify restoration. Confirm cookies, sign-in, signup, barcode camera, offline replay, two-account separation, sign-out, and Home Screen launch on real family phones at the public origin before sending links.

Cloudflare's public HTTP tunnel guidance:
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Set up a tunnel in the dashboard](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)

**Your server and database stay on the Pi.** Cloudflare proxies the traffic; it does not move or host the database, and it can process the proxied traffic. Availability still depends on the Pi, its SD card, your home power/internet, and the connector. The existing offline features remain useful during outages, but synchronization requires the server.

## Moving your phone to the public URL

Browser storage and Home Screen installations belong to an origin. The old Tailscale address and a new public address do not share local queues or drafts, even though both connect to the same Pi/database. On the old installed app, finish and sync pending changes (and complete an active workout if practical). Then open the new address, sign into the same account, and install it. Saved server history is available at either address. Do not clear the old site data while anything is unsynced.

## Later hosting options

A hosted server could run the same frontend/backend with a managed PostgreSQL database. Migrate the database and keep the public domain when moving; accounts and phone installation can remain consistent. This removes the home power/internet dependency but adds hosting costs and operations. SQLite is sufficient for an initial small family rollout on the existing single-worker Pi; reassess concurrency and capacity before opening public signup.

The repository changes alone do not deploy accounts, create real users, configure a domain, purchase hosting, or publish a tunnel.
