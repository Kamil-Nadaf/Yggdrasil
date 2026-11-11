# Yggdrasil privacy policy

Yggdrasil is a self-hosted notes and research app. It has no central server operated by its developer and the developer never receives your data.

## Google Drive sync (optional)

If you choose to connect Google Drive in Settings → Sync:

- You sign in with your own Google account. Yggdrasil requests only the `drive.file` permission, which lets it see and manage **only the files and folders it creates itself** (a folder named "Yggdrasil Vault" by default). It cannot read the rest of your Drive. Device-specific preferences and API keys are never uploaded.
- Your notes, tasks and papers are copied between your own device(s) and that folder in **your** Google Drive. The data goes directly from your computer to Google; it is not sent to the developer or to any third party.
- The sign-in token is stored on your own machine in `.ygg-config/drive-sync.json` and is excluded from git sync.
- You can disconnect at any time in Settings → Sync, and revoke access at https://myaccount.google.com/permissions. Disconnecting does not delete files already on Drive or on your computer.

Yggdrasil's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Other integrations

Task Sync (Google Calendar / Tasks, Microsoft To Do) and Zotero work the same way: you supply your own credentials, they are stored locally, and data goes only between your machine and that provider.

## Contact

Open an issue at https://github.com/Kamil-Nadaf/Yggdrasil/issues.
