# Windows server deployment

Status: in progress (2026-10-24).

GitHub Actions runs on pushes to main and manual dispatch from main. Tests and Windows builds run on GitHub-hosted runners; deployment uses the dedicated bito-ticket runner. Never approve external PR workflows targeting this server.

Server folder: C:/services/Bit-O/ticket. Port: 4106. The BitO-App-ticket scheduled task runs the application under bito_ticket, without administrator privileges. The Actions runner has a separate Windows service. Existing runners are preserved.

Runtime configuration belongs in config/runtime.env on the server, readable only by the project account and administrators. Do not commit or package environment files. Next public build values belong in the BUILD_PUBLIC_ENV repository variable as dotenv text; only NEXT_PUBLIC_* values may be included. Runtime-only secrets never enter the Actions artifact.

A release is checked by SHA and HTTP health before activation. Failed startup restores the previous release. current.json records the active and previous SHAs; logs/runtime.log records application output. Local databases remain under data/. A new accountBook database is initialized from CI-generated demo data only when no database exists.

SSH remains restricted to LocalSubnet. Application ports allow LocalSubnet; external HTTPS hostnames require separately configured Cloudflare Tunnel and OAuth callback URLs.

Verification pending: first Actions build, deployment health, reboot recovery, external access. 

2026-10-24 verification: npm test passed (66 tests); npm run check passed. Shared supervisor integration test passed promotion, startup-failure rollback, invalid release rejection and previous application availability. First GitHub Actions run pending.
