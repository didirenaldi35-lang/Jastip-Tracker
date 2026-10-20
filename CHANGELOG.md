# Changelog

## V.1.0
First live release.
- Desk: orders, shipments, location tracking and finance (ported from the Claude artifact).
- Supabase database with row-level security and realtime updates.
- Email + password sign-in and self sign-up; first account is the Owner, others wait for approval.
- Settings: change password, owner-only Team panel.
- Google sign-in/sign-up built in, switched on with `VITE_ENABLE_GOOGLE=true`.
- Optional public mode (`VITE_PUBLIC_MODE=true`, no login).
