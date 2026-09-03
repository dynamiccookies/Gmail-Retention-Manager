# <img src="icons/retention-manager-icon-128.png" alt="Retention Manager for Gmail icon" width="48" height="48" align="absmiddle"> Retention Manager for Gmail™

[![GitHub License](https://img.shields.io/github/license/dynamiccookies/retention-manager-for-gmail?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/blob/main/LICENSE)
[![GitHub Release Date](https://img.shields.io/github/release-date/dynamiccookies/retention-manager-for-gmail?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/releases/latest)
[![GitHub Release](https://img.shields.io/github/v/release/dynamiccookies/retention-manager-for-gmail?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/releases/latest)

Automatically move Gmail messages to Trash after a retention period defined by a Gmail label.

Gmail filters decide **which conversations receive a retention policy**. Retention Manager decides **when those conversations expire**.

> [!IMPORTANT]
> Retention policies apply to entire Gmail conversations. A new reply resets the retention clock for the conversation. The application moves expired active messages to Trash; it does not permanently delete them.

## Key features

- Retention policies expressed in minutes, hours, days, weeks, calendar months, or calendar years
- Policies applied manually, through Gmail filters, or in bulk
- Managed schedules and manual **Run Now** processing
- Gmail sidebar with status, schedule controls, and basic settings
- Private administration page for complete configuration and diagnostics
- Automatic handling of multiple retention labels
- Message-level processing for conversations containing both active and trashed messages
- Deletion summaries with direct links to conversations in Gmail Trash
- Automatic cleanup of the application’s notification messages
- Safe suggestions for combining simple, redundant Gmail filters
- Settings backups and validated configuration
- Optional GitHub release checks
- Recovery for interrupted runs and large deletion reports

## How it works

1. Apply a retention label such as `Retention/7d` to a Gmail conversation.
2. A managed Apps Script trigger runs on the selected schedule.
3. Retention Manager calculates expiration from the conversation’s newest message.
4. If multiple policies apply, the policy that expires latest wins.
5. Expired active messages are moved to Trash.
6. A deletion summary reports what was moved.

The scan schedule determines when expiration is checked. A seven-day policy does not guarantee processing at the exact moment seven days have passed.

## Installation

Retention Manager is currently available as a manual Google Apps Script installation.

The installation requires three files from the same published release:

- `retention-manager.gs`
- `admin.html`
- `appsscript.json`

Follow the complete [Installation Guide](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Installation).

After installation, use the [Getting Started Guide](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Getting-Started) to configure the schedule, create retention labels, and run the first scan.

## Requirements

- A Gmail account
- Permission to create and authorize a standalone Google Apps Script project
- A desktop browser for the initial installation

A separate Google Cloud project is not required for the manual installation.

## Documentation

| Topic | Documentation |
|---|---|
| Installation | [Installation Guide](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Installation) |
| First-time setup | [Getting Started](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Getting-Started) |
| Retention behavior | [Retention Labels and Processing](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Retention-Labels-and-Processing) |
| Schedules | [Schedules and Time Zones](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Schedules-and-Time-Zones) |
| Settings | [Settings and Administration](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Settings-and-Administration) |
| Gmail filters | [Gmail Filters and Filter Cleanup](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Gmail-Filters-and-Filter-Cleanup) |
| Notifications | [Notifications and Update Checks](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Notifications-and-Update-Checks) |
| Updates and removal | [Updating and Uninstalling](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Updating-and-Uninstalling) |
| Common problems | [Troubleshooting](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Troubleshooting) |
| Common questions | [Frequently Asked Questions](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Frequently-Asked-Questions) |
| Data access | [Permissions, Privacy, and Security](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Permissions-Privacy-and-Security) |
| Maintainer information | [Technical Reference](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Technical-Reference) |

View the complete [GitHub Wiki](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki).

## Permissions and privacy

Retention Manager uses Gmail access to read labels and message metadata, apply or remove labels, move eligible messages to Trash, and send summaries to the account that owns the installation.

Gmail filter-management access is used only when the user explicitly operates Filter cleanup.

Gmail information is processed within the user’s Google Apps Script environment. Optional update checks request public release information from GitHub without sending email content or mailbox metadata.

See [Permissions, Privacy, and Security](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Permissions-Privacy-and-Security) for details.

## Releases and support

- [Download the latest release](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/releases/latest)
- [Review all releases](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/releases)
- [Report a problem or request a feature](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/issues)
- [Troubleshoot a problem](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/wiki/Troubleshooting)

Before posting execution logs publicly, remove email addresses, message subjects, conversation IDs, and other private mailbox information.

## Contributing

Issues and pull requests are welcome. Review the existing issues before submitting a duplicate request.

## License

This project is available under the [MIT License](https://github.com/dynamiccookies/Retention-Manager-for-Gmail/blob/main/LICENSE).

Retention Manager for Gmail™ is an independent project and is not affiliated with Google. Gmail is a trademark of Google LLC.
