# Outlook / Microsoft 365 calendar setup

The Outlook button stays hidden until all of this is set. Nothing changes for Google users.

## 1. Register the app (Azure)
- Go to portal.azure.com, then Microsoft Entra ID, then App registrations, then New registration.
- Name: the CRM name (customers never see it; staff see it on the consent screen).
- Supported account types: "Accounts in any organizational directory and personal Microsoft accounts" (multitenant + personal).
- Redirect URI: platform Web, value `https://<your CRM domain>/api/auth/microsoft/callback`. This is the one fixed callback. It must match `MICROSOFT_REDIRECT_URI` exactly.
- Click Register. Copy the Application (client) ID.

## 2. Client secret
- Certificates and secrets, then New client secret. Pick the longest expiry (24 months) and put the renewal date on the calendar.
- Copy the secret Value right away (it is shown once).

## 3. API permissions
- API permissions, then Add a permission, then Microsoft Graph, then Delegated:
  - `offline_access`
  - `User.Read`
  - `Calendars.ReadWrite`
  - `Calendars.Read.Shared` (needed to read a subcontractor's shared free/busy)
- None of these need admin consent for a normal user. Some client companies block user consent: their Microsoft 365 admin must approve the app once (Entra ID, Enterprise applications, the app, Permissions, Grant admin consent), or open `https://login.microsoftonline.com/<their tenant>/adminconsent?client_id=<client id>`.
- Click "Grant admin consent" on your own tenant too, so your staff are not prompted.

## 4. Vercel environment variables
- `MICROSOFT_CLIENT_ID` = Application (client) ID
- `MICROSOFT_CLIENT_SECRET` = the secret Value
- `MICROSOFT_REDIRECT_URI` = the same callback URL as step 1
- `MICROSOFT_TENANT` = optional, leave unset for `common`
- `SECRETS_ENCRYPTION_KEY` = must already be set (32+ characters); Outlook tokens are sealed with it. Never change it afterwards.
- Redeploy after saving.

## 5. Database
- Apply `supabase/migrations/202611300090_user_microsoft_tokens.sql` before turning the variables on.

## How it behaves
- Each person connects one calendar: Google or Outlook. Connecting one disconnects the other (confirmed first).
- The install-scheduling account (`orgs.install_scheduling_user_id`) can be either; installs, free/busy and RSVPs follow that user's calendar.
- Subcontractors: they share their Outlook calendar with the scheduling account at "Can view when I'm busy". If not shared, the board shows "not shared", never "free".
- Invites: Graph always emails attendees when an event has them and has no "send nobody" switch. When the org's invite setting is off ("none") (demo companies, support sessions): new Outlook events are created without attendees, and an existing Outlook event that has guests is NOT updated or deleted (the install board shows a sync warning / the unassign shows a calendar warning) because Graph would mail the guests.
- Switching provider: blocked while the install-scheduling account has upcoming install events on its calendar (event ids belong to one provider). Move or unassign those installs, or nominate another account, then switch. A stored id from the other provider is treated as missing (recreated) so sync never wedges.
- All-day installs are written as a date at midnight in the company time zone and read back as that local day.
- Events written before someone switches provider stay on the old calendar and are not removed automatically.
- Install calendar id: an address-style id (a Google calendar id) is ignored for Outlook and the user's own calendar is used.
- Needs verification against a real tenant before relying on it: getSchedule permission scope and the not-shared error codes.
