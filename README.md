# <img src="icons/retention-manager-icon-128.png" alt="Retention Manager for Gmail icon" width="48" height="48" align="absmiddle"> Retention Manager for Gmail™

[![GitHub License](https://img.shields.io/github/license/dynamiccookies/retention-manager-for-gmail?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/blob/main/LICENSE)
[![GitHub File Size](https://img.shields.io/github/size/dynamiccookies/retention-manager-for-gmail/retention-manager.gs?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/blob/main/retention-manager.gs)
[![GitHub Release Date](https://img.shields.io/github/release-date/dynamiccookies/retention-manager-for-gmail?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/releases/latest)
[![GitHub Release](https://img.shields.io/github/v/release/dynamiccookies/retention-manager-for-gmail?style=for-the-badge)](https://github.com/dynamiccookies/retention-manager-for-gmail/releases/latest)

Automatically move active Gmail messages to Trash after a retention period defined by a Gmail label.

Retention Manager for Gmail™ is an independent project and is not affiliated
with Google. Gmail is a trademark of Google LLC.

Gmail filters decide **which conversations receive a retention policy**. This Google Apps Script decides **when those conversations expire**. Add, rename, or remove retention labels without modifying the script.

## Features

- Label-driven retention policies such as `Retention/7d`, `Retention/2 weeks`, or `Retention/6 months`
- Minutes, hours, days, weeks, calendar months, and calendar years
- Multiple aliases and optional spaces in label names
- Automatic first-run creation of `Retention`, `Retention/7d`, and `Retention/1m`
- Calendar-aware month and year calculations
- New replies reset the retention clock for the entire Gmail conversation
- The longest policy wins when multiple retention labels are present
- Shorter or equivalent retention labels are automatically removed
- Active messages in expired conversations are moved to Trash, not permanently deleted by the script
- Mixed Inbox/Trash conversations are processed without reprocessing messages already in Trash
- HTML deletion summaries with direct links to the trashed Gmail conversations
- Automatic cleanup of the script's own notification messages and temporary labels
- Optional GitHub release checks with update notices in notification emails
- Persistent, validated settings that survive source-code updates
- Gmail sidebar dashboard with runtime status, schedule management, root-label
  editing, Run Now, and a link to the complete administration page
- Private HTML administration page for advanced configuration, backups, logging,
  and diagnostics
- Managed time-driven schedules that can be created or changed from Gmail
- Contacts-style cleanup suggestions for simple, redundant retention filters
- Fail-closed Gmail metadata preflight before retention changes begin
- Narrow Gmail API authorization through `gmail.modify`, with
  `gmail.settings.basic` used only for explicit filter cleanup
- Verbose diagnostic logging for installation and troubleshooting
- Script locking and batch processing to reduce duplicate or overlapping work

## How It Works

1. Apply retention labels through Gmail filters, manually, or in bulk. Filters can label new messages as they arrive or apply a policy en masse to matching existing conversations.
2. A managed time-driven Apps Script trigger runs the retention processor on the
   schedule selected in the Gmail sidebar.
3. The script finds every label beneath the configured root label that contains a valid retention expression.
4. For each labeled conversation, the script calculates expiration from the newest message date.
5. When multiple retention labels exist, the policy with the latest actual expiration timestamp wins.
6. Active messages in expired conversations are moved to Gmail Trash. Messages already in Trash are skipped.
7. The script sends a summary email containing the subject, sender, received date, retention policy, and a link to each trashed conversation.

> [!IMPORTANT]
> Gmail retention labels operate at the **conversation/thread level**. When one message in a conversation receives a retention label, the policy applies to every active message in the conversation. A new reply resets the retention clock for the entire conversation. Messages already in Trash are skipped without preventing remaining active messages from being processed.

## Requirements

- A Gmail account
- Permission to create and authorize a standalone Google Apps Script project

## Installation

### 1. Download the application files

Download these three files from the
[latest release](https://github.com/dynamiccookies/retention-manager-for-gmail/releases/latest):

- `retention-manager.gs`
- `admin.html`
- `appsscript.json`

### 2. Create a Google Apps Script project

1. Open [Google Apps Script](https://script.google.com/) and verify that the account shown in the upper-right corner is the Gmail account you want the script to manage. This is especially important when you are signed in to multiple Google accounts.
2. Select **New project**.
3. Rename the project to `Retention Manager for Gmail`.
4. Delete the sample `myFunction()` code from `Code.gs`.
5. Rename `Code.gs` to `retention-manager.gs` and paste the corresponding file contents.
6. Add an HTML file named `admin` and paste the contents of `admin.html`.
7. Open **Project Settings** and enable **Show "appsscript.json" manifest file in editor**.
8. Return to the editor and replace the manifest with the downloaded `appsscript.json` contents.
9. Save the project.

The manifest enables the Advanced Gmail service automatically. Do not create or
associate a separate Google Cloud project, and do not manually add the Google
Apps Script API.

### 3. Set the project time zone

1. Open **Project Settings** in the Apps Script sidebar.
2. Confirm that the project time zone matches your local time zone.

The time zone affects notification timestamps and calendar-based date calculations.

### 4. Deploy the private administration page

1. Select **Deploy → New deployment**.
2. Choose **Web app** as the deployment type.
3. Enter `Advanced Settings` as the description.
4. Select **Execute as me**.
5. Limit access to **Only myself**.
6. Select **Deploy**.

Keep this versioned, non-test deployment active. Retention Manager for Gmail™
discovers and stores its URL automatically; the installer does not paste or save
the URL anywhere.

### 5. Install the Gmail add-on

1. Select **Deploy → Test deployments**.
2. Select **Install** for the Google Workspace add-on.
3. Open or refresh Gmail.
4. Open Retention Manager for Gmail™ from Gmail's right sidebar.
5. Review and approve the requested permissions.
6. If Google displays a **Google hasn't verified this app** warning, select **Advanced** and continue only if you obtained the code from this repository.

On its first opening, the sidebar automatically creates a one-time trigger that
records the private web-app URL and then deletes itself. If the card temporarily
shows **Advanced Settings — Setting Up…**, wait briefly and select **Refresh**.
No setup function needs to be selected from the Apps Script editor.

### 6. Configure and test retention

1. Choose a schedule in the Gmail sidebar.
2. Leave the default root label as `Retention`, or change it before creating filters.
3. Select **Save Settings**. The application creates or updates its managed schedule trigger.
4. Select **Run Now** to perform the first retention scan.

On a new installation, this run automatically creates:

```text
Retention
Retention/7d
Retention/1m
```

The starter sublabels are created **only when the root label does not already exist**. If `Retention` already exists—even with no child labels—the script assumes you have intentionally customized the label structure and does not recreate the defaults.

Run Now does not affect messages unless they already have a valid retention label
and their retention period has expired.

> [!NOTE]
> The trigger schedule determines enforcement precision. A `Retention/12hrs` label does not cause the script to run every 12 hours. It expires after 12 hours, but the message is moved to Trash only on the next scheduled execution.

## Create Gmail Retention Filters

Gmail filters apply retention labels automatically based on sender, recipient, subject, keywords, or other Gmail search criteria.

### Example: Delete messages from example.com after seven days

1. Open Gmail.
2. Open the advanced search options in the Gmail search bar.
3. Enter `example.com` in the **From** field, or use this Gmail search:

```text
from:example.com
```

4. Select **Create filter**.
5. Check **Apply the label**.
6. Select `Retention/7d`.
7. Optionally check **Also apply filter to matching conversations** to include existing messages.
8. Select **Create filter**.

To change the policy later, edit the Gmail filter and select a different retention label. The script does not need to be modified.

### Consolidate redundant retention filters

Advanced Settings includes a **Filter cleanup** panel. It suggests a merge only
when two or more Gmail filters apply the same valid retention-policy label, have
no other action, and each uses one simple sender, recipient, or subject
criterion. Complex filters and filters that archive, mark read, forward, remove
labels, or perform any other action are left unchanged.

Reviewing a suggestion shows every original criterion and the proposed combined
Gmail `OR` query. When **Merge filters** is selected, the application creates
and verifies the replacement before deleting any original. It stores a bounded
undo record and downloads a JSON backup of the original definitions. **Undo
last merge** recreates the originals before removing the combined replacement.

## Supported Retention Labels

The default root label is `Retention`. The number must be a positive integer. Spaces between the number and unit are optional, and matching is case-insensitive.

| Unit | Examples | Accepted aliases |
|---|---|---|
| Minutes | `Retention/15min`, `Retention/15 minutes` | `min`, `mins`, `minute`, `minutes` |
| Hours | `Retention/2h`, `Retention/2 hours` | `h`, `hr`, `hrs`, `hour`, `hours` |
| Days | `Retention/7d`, `Retention/7 days` | `d`, `day`, `days` |
| Weeks | `Retention/2w`, `Retention/2 weeks` | `w`, `wk`, `wks`, `week`, `weeks` |
| Months | `Retention/1m`, `Retention/6 months` | `m`, `mo`, `mos`, `mon`, `mons`, `month`, `months` |
| Years | `Retention/1y`, `Retention/2 years` | `y`, `yr`, `yrs`, `year`, `years` |

### Minutes versus months

The single-letter alias `m` always means **month**. Use `min`, `mins`, `minute`, or `minutes` for minutes.

This intentionally favors the longer retention period when the abbreviation is ambiguous.

### Custom root label

Changing the root label is optional. Leave the default setting unchanged unless you want to replace the word `Retention` in every managed label with another term.

For example, change:

```json
"ROOT_LABEL": "Retention"
```

to:

```json
"ROOT_LABEL": "Email Cleanup"
```

The script will then recognize labels such as:

```text
Email Cleanup/7d
Email Cleanup/30 days
Email Cleanup/6 months
```

Starter labels, notification labels, system labels, and label parsing are all
derived from `ROOT_LABEL`. Changing the root from the sidebar or administration
page renames the existing root and child labels in place. Gmail filters continue
to reference the same label IDs, so they follow the renamed labels automatically.

## Multiple Retention Labels

When a conversation has more than one valid retention label, the script calculates the actual expiration timestamp for every policy using the newest message date.

The policy that expires latest wins. All shorter or equivalent policies are removed automatically.

For example, a conversation may have:

```text
Retention/1 month
Retention/45 days
```

The script does not assume that one month equals 30 days. It calculates both expiration dates from the newest message date. In most cases, `45 days` expires later and is retained while `1 month` is removed.

Equivalent policies are resolved deterministically. For example, `Retention/60min` and `Retention/1h` produce the same expiration timestamp, so the script keeps one stable winner and removes the duplicate policy.

## Date and Time Calculations

- **Minutes and hours:** elapsed-time arithmetic
- **Days and weeks:** calendar-day arithmetic
- **Months and years:** calendar-aware arithmetic

Calendar months and years are not converted into fixed numbers of days. Invalid target dates are clamped to the final valid day of the target month. For example, one month after January 31 becomes the last valid day of February.

## Notification Emails

When ordinary messages are moved to Trash, the script sends a notification to the Gmail account that owns the trigger.

Example subject:

```text
[Gmail Retention] 12 messages deleted
```

The HTML notification includes:

| Column | Description |
|---|---|
| Subject | Links directly to the conversation in Gmail Trash using the owning account's email address |
| Sender | Original sender information |
| Received | Original message date and time |
| Retention | Winning retention label that caused expiration |

Large deletion runs are split into multiple notification emails based on `MAX_ROWS_PER_NOTIFICATION`. Each subject includes the overall message count and the part number.

### Notification cleanup

Generated notifications receive two labels automatically:

```text
Retention/1d
Retention/_System
```

The exact names are derived from the configured root and notification suffixes.
The `_System` label uses red by default. Its color can be changed from Advanced
settings, or reset to Gmail's default uncolored-label appearance.

When the notification retention period expires:

- The notification is moved to Trash silently.
- It is not included in another deletion summary.
- Its retention and internal system labels are removed.
- The temporary system label is deleted when no active notification still uses it.

This prevents an endless delete-notify-delete loop and keeps the Gmail label list clean.

## Automatic Update Checks

When `CHECK_FOR_UPDATES` is enabled and a deletion summary is generated, the script checks the repository's latest published GitHub release.

When a newer semantic version is available, the notification footer displays a direct link to that release.

The update check:

- Runs only when a deletion notification is being generated
- Uses the latest published GitHub release
- Ignores draft and prerelease releases returned outside the latest-release endpoint
- Caches the result for up to six hours
- Never blocks retention processing or notification delivery when GitHub is unavailable
- Sends no Gmail message content or mailbox metadata to GitHub

Disable the feature with:

```json
"CHECK_FOR_UPDATES": false
```

## Persistent Configuration

Active settings are stored by Google with the Apps Script project rather than
inside the replaceable `.gs` source file. The script uses one Script Property:

| Property | Value |
|---|---|
| `GMAIL_RETENTION_CONFIG` | A JSON object containing `schemaVersion` and `settings` |

The script automatically creates the property from factory defaults when it is
missing. Every loaded or saved value is validated. Invalid JSON, missing fields,
unknown fields, unsupported retention durations, and invalid data types stop the
run before Gmail is changed. Invalid saved data is not silently overwritten.

During manual testing, the property can be viewed or edited under **Project
Settings → Script Properties**. Save the entire configuration as valid JSON. A
normal initialized value has this structure:

```json
{
  "schemaVersion": 3,
  "settings": {
    "VERBOSE_LOGGING": false,
    "ROOT_LABEL": "Retention",
    "ARCHIVE_ON_LABEL": false,
    "DEFAULT_RETENTION_LABEL_SUFFIXES": ["7d", "1m"],
    "NOTIFICATION_SUBJECT_PREFIX": "[Gmail Retention]",
    "NOTIFICATION_RETENTION_LABEL_SUFFIX": "1d",
    "SYSTEM_NOTIFICATION_LABEL_SUFFIX": "_System",
    "SYSTEM_NOTIFICATION_LABEL_COLOR": "#cc3a21",
    "CHECK_FOR_UPDATES": true
  }
}
```

Configuration schema versions are separate from application releases. When a
supported older schema is loaded, the script validates and migrates it before
saving the current structure. A configuration created by newer application code
is rejected rather than downgraded.

## Configuration Reference

### User settings

| Setting | Default | Purpose |
|---|---:|---|
| `VERBOSE_LOGGING` | `false` | Enables detailed execution logging for troubleshooting |
| `ROOT_LABEL` | `'Retention'` | Parent label used for all managed retention policies |
| `ARCHIVE_ON_LABEL` | `false` | Removes the Inbox label from directly retention-labeled messages that have not expired |
| `DEFAULT_RETENTION_LABEL_SUFFIXES` | `['7d', '1m']` | Starter child labels created only when the root label is absent |
| `NOTIFICATION_SUBJECT_PREFIX` | `'[Gmail Retention]'` | Prefix used for deletion-summary subjects |
| `NOTIFICATION_RETENTION_LABEL_SUFFIX` | `'1d'` | Retention policy applied to generated notifications |
| `SYSTEM_NOTIFICATION_LABEL_SUFFIX` | `'_System'` | Temporary marker used to prevent notification loops |
| `SYSTEM_NOTIFICATION_LABEL_COLOR` | `'#cc3a21'` | Gmail-supported background color for the temporary system label; blank restores Gmail's default color |
| `CHECK_FOR_UPDATES` | `true` | Enables GitHub release checks in generated summaries |

### Internal application constants

These values remain in source code because they are release-controlled behavior,
not user preferences.

| Constant | Value | Purpose |
|---|---:|---|
| `VERSION` | Current release | Installed semantic version displayed in notifications |
| `PROJECT_REPOSITORY_URL` | Project repository | Repository used for notification links and release checks |
| `UPDATE_CHECK_CACHE_SECONDS` | `21600` | GitHub response cache duration, in seconds |
| `UNIT_ALIASES` | Built-in mapping | Maps readable unit names to canonical units |
| `THREAD_PAGE_SIZE` | `100` | Number of labeled threads retrieved per Gmail page |
| `TRASH_BATCH_SIZE` | `100` | Number of active messages processed per Trash batch |
| `MAX_ROWS_PER_NOTIFICATION` | `200` | Maximum table rows in each notification email |
| `LOCK_TIMEOUT_MS` | `5000` | Maximum time to wait for another execution to release the script lock |

## Available Functions

| Function | Purpose |
|---|---|
| `enforceGmailRetention()` | Main retention processor; use this function for the scheduled trigger |
| `diagnoseGmailRetentionLabels()` | Runs label setup and detailed label diagnostics without reading, relabeling, or trashing conversations |
| `getRetentionConfiguration()` | Initializes and returns the versioned active settings without changing Gmail |

## Verbose Diagnostics

Set:

```json
"VERBOSE_LOGGING": true
```

Then run:

```javascript
diagnoseGmailRetentionLabels
```

Verbose output includes:

- Gmail account and session context
- Raw and normalized label names
- Label lookup and creation attempts
- Label verification retries
- Recognized and rejected retention policies
- Thread IDs and message subjects during normal enforcement
- Expiration calculations and winning-policy decisions
- Redundant-label removal
- Trash batches and notification actions
- GitHub update-check responses

> [!WARNING]
> Verbose logs may contain mailbox metadata, including subjects, label names, and thread IDs. Set `VERBOSE_LOGGING` back to `false` after troubleshooting.

## Troubleshooting

### Starter labels were not created

The default labels are created only when the configured root label does not exist at all.

If `Retention` already exists, the script intentionally does not create `Retention/7d` or `Retention/1m`. Create the desired child labels manually, or remove the empty root label and rerun `enforceGmailRetention()`.

### The script says no valid retention labels were found

Check that:

- The label begins with the configured `ROOT_LABEL`.
- The label contains a positive integer.
- The unit is one of the supported aliases.
- Minutes use `min` or a longer minute alias, not `m`.

Valid examples:

```text
Retention/12hrs
Retention/12 hours
Retention/7d
Retention/6 months
```

Run `diagnoseGmailRetentionLabels()` with verbose logging enabled to see exactly how every Gmail label is being parsed.

### A short retention period did not run on time

The retention period controls eligibility for deletion. The trigger controls when the script checks that eligibility.

A 12-hour policy paired with a daily trigger may remain in Gmail until the next daily run—nearly 24 additional hours. Use a more frequent trigger when testing minute or hour policies.

### A Trash link opens the wrong Gmail account

The script builds Trash links using the Gmail account's email address rather than the browser-specific `/u/0/`, `/u/1/`, or `/u/5/` account index.

Confirm that the target Gmail account is signed in within the browser opening the link.

### Advanced Settings fails when multiple Google accounts are signed in

Google Apps Script does not support simultaneous multi-login reliably for add-ons
or web apps. If Advanced Settings opens a Google Drive access-error page, sign
out of the other Google accounts and retry while signed in only to the account
that owns this installation. Alternatively, open the web-app URL in an
Incognito/private window and sign in only to that account.

### No update notice appears

The update notice appears only when:

- `CHECK_FOR_UPDATES` is `true`.
- A deletion notification is generated.
- The repository has a published release newer than the installed `VERSION`.
- The release tag uses semantic versioning, such as `v0.7.0`.

GitHub failures and rate limits are intentionally nonfatal and suppress the notice for that run.

### The script requests authorization again after an update

A new script version may use an additional Google service or authorization scope. Review and approve the requested permissions before relying on the scheduled trigger.

## Permissions and Privacy

The script requires access necessary to:

- Read Gmail labels, conversations, and message metadata
- Add and remove Gmail labels
- Move messages or conversations to Trash or Inbox
- Review, create, and remove Gmail filters when the user explicitly runs Filter cleanup
- Create and send deletion-summary emails to the same account
- Contact the public GitHub Releases API when update checks are enabled
- Use Apps Script cache and locking services

The script processes Gmail data inside the user's Google Apps Script environment. The optional GitHub update check sends only a request identifying the public repository and does not transmit email content.

The script only processes:

- Conversations carrying a valid retention label beneath the configured root
- Notification conversations carrying the script's temporary system label

## Disable or Uninstall

To stop automatic processing without removing the project:

1. Open the Gmail sidebar.
2. Turn off **Schedule → Enabled**.
3. Select **Save Settings**.

To uninstall completely:

1. Disable the schedule from the Gmail sidebar.
2. Open **Deploy → Test deployments** in the Apps Script project and uninstall the add-on.
3. Archive the private web-app deployment under **Manage deployments**.
4. Delete the Apps Script project.
5. Remove any Gmail retention labels and filters you no longer need.

Uninstalling the script does not restore conversations already in Trash.

## Updating

### One-time migration from v0.5.0 or earlier

Versions through v0.5.0 stored user choices directly in `RETENTION_CONFIG`.
Use this migration sequence so the retention job never runs with unintended
defaults:

1. Before replacing the old source, record any customized values for the user settings in the configuration reference.
2. Replace the source and save the project.
3. Run `getRetentionConfiguration()` once. This creates the Script Property without reading, relabeling, or trashing Gmail messages.
4. Open **Project Settings → Script Properties** and apply the recorded values inside `GMAIL_RETENTION_CONFIG`.
5. Run `enforceGmailRetention()` and confirm the execution succeeds with the migrated settings.

This manual migration is required only once; later source replacements preserve
the project-scoped Script Property.

### Routine source update

1. Download the newest `retention-manager.gs`, `admin.html`, and
   `appsscript.json` files from the
   [latest release](https://github.com/dynamiccookies/retention-manager-for-gmail/releases/latest).
2. Replace all three existing files in Apps Script and save the project.
3. Open **Deploy → Manage deployments** and edit the active web-app deployment.
4. Select **New version**, then select **Deploy**. Updating the existing
   deployment preserves its URL.
5. Refresh Gmail and reopen the sidebar.
6. Approve any newly requested permissions.
7. Select **Run Now** and confirm the scan succeeds.

The active `GMAIL_RETENTION_CONFIG` Script Property remains separate from the
replaced source code. Routine updates do not require settings to be reapplied.

## Contributing

[Issues](https://github.com/dynamiccookies/retention-manager-for-gmail/issues) and pull requests are welcome. Before submitting a bug report, enable verbose logging and include the relevant execution log with private mailbox information removed.

## License

See the repository's [LICENSE](https://github.com/dynamiccookies/retention-manager-for-gmail/blob/main/LICENSE) file.
