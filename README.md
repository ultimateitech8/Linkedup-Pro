# Linkedup Pro

A professional network with project contribution verification and employer-updated application timelines. This first build includes a responsive feed, profiles, connections, live private messaging, jobs, hiring, and saved items. Demo accounts are available in development only.

## Local development

Use Node.js 22 or newer and PostgreSQL 17. With Docker, start a development database:

```sh
docker run --rm --name linkedup-dev-db -e POSTGRES_USER=linkedup -e POSTGRES_PASSWORD=linkedup -e POSTGRES_DB=linkedup -p 127.0.0.1:55433:5432 -v linkedup-dev-db:/var/lib/postgresql/data postgres:17-alpine
```

In a second terminal, install and start the app:

```sh
npm ci
DATABASE_URL=postgres://linkedup:linkedup@127.0.0.1:55433/linkedup npm run dev
```

With an existing PostgreSQL installation, create a database for the app and use its connection string as `DATABASE_URL`.

Open [http://localhost:3000](http://localhost:3000). Development opens the demo as Alex Morgan. Use **Demo workspace** in the sidebar, or **Settings** on mobile, to switch to Maya for project verification and moderation or Jordan to manage Forma's job and download a candidate's résumé. To try registration, sign out and choose **Create an account**.

Run `npm run typecheck` or `npm run build` from the project root. Set `DEMO_MODE=false` when using development mode without demo accounts.

The browser connects directly to the local API on port 4000 for WebSockets. If you change that port, set `NEXT_PUBLIC_REALTIME_URL` for the web app and `API_INTERNAL_URL` for its HTTP API proxy. The VPS setup handles both through Caddy.

In **Groups**, Alex belongs to Product Design Exchange and has an invitation to the private Research Roundtable. Switch to Maya to try membership approvals, inviting a connection, and hiding or restoring a discussion.

In **Events**, Alex is invited to Maya’s Portfolio review clinic. Jordan hosts Product teams meetup. Organizers provide HTTPS meeting or livestream links, and registered attendees can use them shortly before the start or when the host marks the session live. The API checks for upcoming registrations every 30 seconds and sends an in-app reminder during the hour before the event.

Open **Articles** from the sidebar or **More** on mobile. Maya publishes *Inside the Design Review*, and Alex is subscribed. Publish an edition as Maya and use Alex’s notification to open it. Covers accept JPEG, PNG, and WebP uploads up to 5 MB. Inline media supports HTTPS images and YouTube videos. The publishing frequency describes the newsletter’s cadence, and each edition is sent to in-app notifications when it is published.

Open **Companies** from the sidebar or **More** on mobile. Jordan owns Forma, where Alex can follow updates and open the design listing. Company Page admins can post jobs and review applications together. Jobs created through the standalone form stay with their original poster.

Open **Learning** from the sidebar or **More** on mobile. Alex can browse courses and learning paths, enroll, and earn a completion certificate by finishing the lessons and passing their quizzes. Completed certificates stay private until a member adds them to their profile. Switch to Maya for **Instructor studio**, where you can create courses with notes, YouTube videos, practice exercises, and quizzes, or assemble published courses into a learning path. Published courses keep their lesson sequence and completion requirements.

Open **Services** from the sidebar or **More** on mobile. As Alex, request a proposal for Maya’s **Design system audit**. Switch to Maya to open the incoming request, chat with Alex, and send a quote with a scope and delivery date. After Alex accepts the proposal, Maya can mark the work as delivered. Alex can then confirm completion and leave a review. Providers can hide listings or pause new requests. Existing requests stay available to both participants.

Open **Sales** from the sidebar or **More** on mobile. As Alex, save Maya as a lead and Forma as an account. Edit the lead in **Pipeline** to set a stage, private notes, and a follow-up time. In **Saved accounts**, turn on alerts for new jobs at Forma. The API checks for sales alerts every 30 seconds. **Lists** lets you group saved leads and companies, and download a list or the whole workspace as CSV.

Open **Campaigns** as Jordan to create a Forma campaign, or choose **Promote update** in the menu on a company post. Campaigns can run immediately or on a schedule. The impression budget is the maximum number of feed deliveries, and each member can receive a campaign once per UTC day. Use Alex to see a matching campaign on Home and try its call to action. For lead campaigns, contact information is shared with company admins only after the member submits the consent form. Reports include impressions, reach, CTA clicks, and submitted leads.

Open **Analytics** from the sidebar or **More** on mobile. Use the 7-, 30-, or 90-day range for your profile, posts, articles, newsletters, company pages, hiring pipeline, and campaigns. Visit Maya’s profile or open an article as Alex, then switch to Maya to see the activity. Profile views, search appearances, and post, article, and company-page activity count once per member and item per UTC day. These dated counters start with the analytics migration. Existing hiring and campaign records are included by their original dates. Company and hiring reports follow current management permissions.

Open **AI Assistant** from the sidebar or **More** on mobile. The **Job fit** tab compares your profile skills with the employer’s listed requirements directly in Linkedup Pro. As Alex, try Forma’s Senior Product Designer listing. Job managers can add or edit a listing’s required skills. With OpenAI configured, the assistant can also draft or proofread text, write hiring descriptions, provide career and job-preparation guidance, and search actual open listings from a plain-language request.

Enable generation with a server-side `OPENAI_API_KEY` in `.env` and restart the API. `OPENAI_MODEL` defaults to `gpt-5.4-mini`. `AI_DAILY_LIMIT` limits provider requests per member per UTC day and defaults to 12. A generation request sends the text shown in the AI tool to OpenAI. Job-preparation requests send the selected listing and the member’s profile skills. The application stores daily usage counts in PostgreSQL. AI suggestions enter a composer when a member applies them, and existing save, publish, or send actions handle the resulting text.

[OpenAI API setup](https://developers.openai.com/api/docs/quickstart) and [provider data controls](https://developers.openai.com/api/docs/guides/your-data) describe the provider account setup and handling of API requests.

To try verification and password recovery locally, set the SMTP variables from `.env.example` and start the app with `DEMO_MODE=false`. A local development mail catcher can use port 1025. With no SMTP configured, the local demo still supports sign-in and registration.

## VPS configuration

Copy `.env.example` to `.env` and set the site domain and HTTPS `APP_URL`. Generate `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` separately with `openssl rand -hex 32`. Point the domain's DNS records at the VPS and open TCP ports 80 and 443.

- Set `SMTP_HOST`, `SMTP_PORT`, and `MAIL_FROM` for verification and password recovery. Use your provider's SMTP credentials if required. Production requires TLS, using implicit TLS on port 465 and STARTTLS on other ports.
- Set `BETA_INVITE_EMAILS` to the comma-separated list of allowed registration addresses. The app verifies control of the invited address before granting access.
- Set `MODERATOR_EMAILS` to the verified accounts that can review reports. Include them in the invitation list when they need to register.
- Set `LEARNING_INSTRUCTOR_EMAILS` to the comma-separated list of verified accounts that can publish Learning courses and paths. Include new instructors in `BETA_INVITE_EMAILS` so they can register.
- Set `OPENAI_API_KEY` to enable AI generation. Compose passes the key to the API container. Job-fit comparisons work with the key blank.

```sh
docker compose up --build -d
```

Caddy routes all browser traffic. PostgreSQL uses a private Compose volume. The API initializes tables at startup. Keep database backups off the VPS and test restoring them before accepting real member data. The production stack requires its own database and secret and starts with demo accounts disabled.

Applicants can upload a PDF up to 5 MB or provide a résumé link. Uploaded files are stored in PostgreSQL, included in database backups, and downloadable by the applicant and listing owner. Moderators can dismiss reports, hide posts, and restore hidden posts from review history.

After changing the invitation, moderator, or instructor lists, run `docker compose up -d api` to apply the new environment. The invitation list applies to new registrations. The moderator and instructor lists control access to the moderation dashboard and Instructor studio.

## Demo imagery

The featured project artwork was created with the built-in image generation tool and is saved in `apps/web/public/images/project-feature.jpg`. The demo portraits and workspace photo are stock photos from Unsplash, used to illustrate fictional accounts and posts.

<details>
<summary>Project artwork prompt</summary>

> Landscape editorial 3D image for the background of a compact professional networking dashboard card. Deep midnight-purple studio, with the LEFT 56 percent clean flat midnight violet (approximately #241746) negative space for large white website overlay. On the RIGHT, a single elegant three-dimensional sculpture of three rising translucent lavender rectangular slabs and a solid pastel-lilac arch, carefully stacked like a minimal set of collectible design objects, photographed in a highly polished product studio. They represent layers of a portfolio without literal screens. Crisp bevels, delicate violet refractions, surfaces of satin acrylic and polished glass, grazing lavender highlights, faint purple shadows. Sculptural, architectural, premium, contemporary. Rightmost objects close to edge, upper and lower objects remain legible in a wide center crop. Camera at slightly above eye level, lighting concentrated on the objects, left stays consistently dark. No text, no lettering, no UI, no logos, no illustration outlines, no watermark. Wide horizontal format.

</details>
