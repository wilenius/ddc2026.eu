**DDC European Open 2026**

Registration System -- Technical Specification

Version 1.0 -- March 2026

**1. Overview**

This document specifies a registration form for the DDC European Open
2026 website (ddc2026.eu), hosted as a static Astro site on GitHub
Pages. The backend is a Cloudflare Worker that handles form submission,
Turnstile CAPTCHA verification, and data storage. All code lives in a
single repository.

**2. Architecture**

**2.1 High-level flow**

The system has two components: a static frontend form served by GitHub
Pages, and a Cloudflare Worker that acts as the API backend. The flow is
as follows:

-   User loads the registration page on ddc2026.eu.

-   The page renders a form with Cloudflare Turnstile CAPTCHA widget.

-   On submission, client-side JavaScript POSTs JSON to the Worker
    endpoint.

-   The Worker verifies the Turnstile token with Cloudflare's API.

-   If valid, the Worker stores the registration in Cloudflare KV and
    returns success.

-   The frontend displays a confirmation message.

**2.2 Repository structure**

ddc2026.eu/

├── src/ \# Astro source

│ ├── pages/

│ │ └── register.astro \# Registration page

│ ├── components/

│ │ └── RegistrationForm.astro

│ └── layouts/

├── worker/ \# Cloudflare Worker

│ ├── src/

│ │ └── index.ts \# Worker entry point

│ ├── wrangler.toml \# Worker config

│ └── package.json

├── astro.config.mjs

└── package.json \# Root package.json

The worker/ subdirectory is an independent npm package with its own
wrangler.toml. Deployment is separate from the Astro site: the Astro
site deploys to GitHub Pages via GitHub Actions, and the Worker deploys
to Cloudflare via wrangler.

**3. Frontend specification**

**3.1 Registration form fields**

  --------------- ----------- -------------- ----------------------------------
  **Field**       **Type**    **Required**   **Notes**

  Full name       text        Yes            

  Email           email       Yes            Used as unique identifier

  Country         select      Yes            Dropdown of countries

  Club/team       text        No             Optional affiliation

  Partner name    text        No             DDC is a pairs sport

  Partner email   email       No             For partner notifications

  Division        select      Yes            Open / Mixed / Women's

  Comments        textarea    No             Dietary needs, etc.
  --------------- ----------- -------------- ----------------------------------

**3.2 Turnstile integration**

The Cloudflare Turnstile widget is embedded in the form. It provides a
site key (public, embedded in HTML) and a secret key (stored as a Worker
secret). On form submission, the Turnstile widget produces a token that
is included in the POST body.

-   Load the Turnstile script:
    https://challenges.cloudflare.com/turnstile/v0/api.js

-   Render the widget in the form with the site key.

-   On submit, read the token from the widget and include it as
    cf-turnstile-response in the JSON payload.

**3.3 Client-side behaviour**

-   Validate required fields before submission (HTML5 validation +
    custom checks).

-   POST JSON to the Worker endpoint using fetch().

-   Show a loading state during submission.

-   On success (HTTP 200), display a confirmation message and hide the
    form.

-   On error (HTTP 4xx/5xx), display the error message from the response
    body.

-   On network failure, display a generic error with a retry option.

**4. Backend specification (Cloudflare Worker)**

**4.1 Endpoint**

  ------------ ---------------- -------------------------------------------
  **Method**   **Path**         **Description**

  POST         /register        Submit a new registration

  GET          /registrations   List all registrations (admin, protected)

  OPTIONS      /\*              CORS preflight handler
  ------------ ---------------- -------------------------------------------

**4.2 POST /register flow**

1.  Parse JSON body.

2.  Verify Turnstile token by POSTing to
    https://challenges.cloudflare.com/turnstile/v0/siteverify with the
    token and the secret key.

3.  If Turnstile verification fails, return 403 with error message.

4.  Validate required fields (name, email, country, division). Return
    400 on failure.

5.  Check for duplicate email in KV. Return 409 if already registered.

6.  Store registration object in KV with key reg:{email} and value as
    JSON.

7.  Also append the email to a KV key reg:\_index (JSON array) for
    listing.

8.  Return 200 with confirmation.

**4.3 GET /registrations (admin)**

Protected by a simple shared secret passed as an Authorization: Bearer
\<token\> header. The token is stored as a Worker secret. This endpoint
reads the reg:\_index key, then fetches each registration from KV. It
returns a JSON array of all registrations. This is for organiser use
only -- not exposed in the frontend.

**4.4 CORS configuration**

The Worker must return appropriate CORS headers to allow requests from
the frontend origin:

-   Access-Control-Allow-Origin: https://ddc2026.eu

-   Access-Control-Allow-Methods: POST, GET, OPTIONS

-   Access-Control-Allow-Headers: Content-Type, Authorization

The OPTIONS handler returns these headers with a 204 response.

**4.5 Storage (Cloudflare KV)**

Cloudflare KV is a globally distributed key-value store. It is
eventually consistent, which is acceptable for registration data at this
scale. The KV namespace is bound to the Worker via wrangler.toml.

  ------------------- ------------------- -------------------------------
  **Key pattern**     **Value**           **Purpose**

  reg:{email}         JSON object         Individual registration record

  reg:\_index         JSON array          List of all registered emails
  ------------------- ------------------- -------------------------------

Each registration object contains: name, email, country, club,
partnerName, partnerEmail, division, comments, registeredAt (ISO
timestamp), ip (onal, from request headers).

**4.6 Secrets and environment variables**

  ----------------------- --------------- -------------------------------
  **Variable**            **Source**      **Description**

  TURNSTILE_SECRET        Secret          Turnstile secret key for
                                          verification

  ADMIN_TOKEN             Secret          Bearer token for admin
                                          endpoints

  ALLOWED_ORIGIN          Var             https://ddc2026.eu

  REGISTRATIONS           KV binding      KV namespace for registration
                                          data
  ----------------------- --------------- -------------------------------

Secrets are set via wrangler secret put \<NAME\> and never committed to
the repository.

**5. Deployment**

**5.1 Astro site (GitHub Pages)**

The existing GitHub Actions workflow builds and deploys the Astro site.
No changes needed beyond adding the registration page and form
component.

**5.2 Cloudflare Worker**

Deployment is via wrangler from the worker/ directory:

cd worker

npx wrangler deploy

This can also be added as a GitHub Actions job triggered on changes to
the worker/ directory.

**5.3 Turnstile setup**

-   In the Cloudflare dashboard, go to Turnstile and create a new site
    widget.

-   Set the domain to ddc2026.eu.

-   Copy the site key into the frontend Turnstile widget configuration.

-   Copy the secret key and store it as a Worker secret
    (TURNSTILE_SECRET).

**5.4 KV namespace setup**

npx wrangler kv:namespace create REGISTRATIONS

Copy the returned namespace ID into wrangler.toml.

**6. Security considerations**

-   Turnstile CAPTCHA prevents automated spam submissions.

-   CORS restricts requests to the frontend origin only.

-   Input validation on the Worker (not just client-side) prevents
    malformed data.

-   Secrets are never committed to the repository.

-   The admin endpoint requires a bearer token.

-   Rate limiting: Cloudflare's default Worker rate limiting applies.
    For additional protection, consider adding a custom rate limiter
    (e.g. by IP using KV with TTL).

-   Email addresses stored in KV are personal data under GDPR. Consider
    adding a privacy notice to the form and a data retention/deletion
    plan.

**7. Future considerations**

These are out of scope for the initial implementation but may be
relevant later:

-   Email confirmation: send a verification email on registration
    (requires an email service integration, e.g. Resend or Mailgun).

-   Payment integration: if a registration fee is added, integrate with
    Stripe Checkout. The Worker would create a Stripe session and
    redirect.

-   Admin dashboard: a simple protected page listing registrations,
    exportable as CSV.

-   Registration cap: enforce a maximum number of registrations.

-   Waitlist: once the cap is hit, allow waitlist sign-ups.
