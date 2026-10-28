# FitCheck Studio

Compare two watch appearances, save a favorite, add a private note and export a photo-free shortlist.

- [Working recorded-result demo](https://kaivenn52.github.io/fitcheck-studio-demo/)
- [79-second demo video (Unlisted)](https://youtu.be/d5IkrkLK_OA)

This repository contains the complete React browser app, Node/Express live API server, tests, original illustrations and installation inputs. Credentials and private account screenshots are excluded.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4818 . Default fixture mode needs no account or paid units. The recorded example displays actual prior YouCam outputs generated on original project-authored illustrations, with explicit labels and no new API requests.

## Live YouCam integration

Copy `.env.example` to `.env` locally. Set your own `YOUCAM_API_KEY`, `YOUCAM_LIVE_ENABLED=true` and `YOUCAM_ALLOW_UNIT_USAGE=true`, then restart. Never commit the private environment file. Live tasks consume provider units and require the UI's image-rights, privacy-transfer and unit-use confirmations.

The adapter reserves files through the File API, uploads sanitized JPEG bytes, creates two asynchronous Watch VTO tasks sharing one wrist image, polls acknowledged task IDs and serves owner-scoped results. Sharp validates images and strips metadata. Jobs expire after 30 minutes; result caching is capped at 32 MiB. Unknown acknowledgments are not blindly retried. State is process-local and is lost on restart.

Official API guide: https://docs.perfectcorp.com/reference/ai_watch/section/overview

## Verify

```sh
npm test
npm run build
npm run build:review
```

Backend tests cover state, ownership, image validation, result decoding, pricing preflight and injected upstream transport. Injected tests do not prove provider access. `npm run test:ui` additionally requires Microsoft Edge and Playwright.

Two bounded real comparisons previously succeeded: four tasks and six uploads. The hosted demo/video replay the comparison made with original illustrations. They do not offer fresh public inference. No physical fit, sizing, comfort, authenticity, photographic realism, conversion or demand accuracy is claimed. Public live hosting requires additional authentication, durable state and retention controls.

## Licenses and provenance

Original source and vector fixtures are MIT licensed; see LICENSE. Locally bundled fonts retain their SIL OFL notices in licenses/. Third-party npm packages retain their own licenses. The two OpenAPI schema files in research/ are attributed Perfect Corp API contract references and are not relicensed as original project work.

Images in public/fixtures/ are original hand/watch illustrations. public/verified-samples/ contains rasterizations of these illustrations and actual YouCam outputs generated from them. No real person's photo or third-party watch branding is included. Official Playground sample photos, account screenshots and internal review videos are excluded.

The Devpost entry remains a draft pending owner approval of final submission.
