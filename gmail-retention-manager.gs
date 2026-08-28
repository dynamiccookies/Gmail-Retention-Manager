/**
 * Gmail Label-Based Retention Manager
 * ====================================
 *
 * Repository: https://github.com/dynamiccookies/gmail-retention-manager
 *
 * Version: 0.6.0
 *
 * PURPOSE
 * -------
 * Automatically moves active Gmail messages to Trash after the retention period
 * specified by a Gmail label. Gmail filters decide which conversations receive
 * a retention label; this script only enforces those labels.
 *
 * SUPPORTED LABEL FORMAT
 * ----------------------
 * By default, create labels beneath the "Retention" label. Changing ROOT_LABEL
 * changes that prefix everywhere in the script. Both compact and readable forms
 * are accepted, with or without whitespace between the number and unit:
 *
 *   Retention/15min       = 15 minutes
 *   Retention/2 hours     = 2 hours
 *   Retention/7d          = 7 days
 *   Retention/2 weeks     = 2 weeks
 *   Retention/1 month     = 1 calendar month
 *   Retention/1yr         = 1 calendar year
 *
 * Supported unit aliases are case-insensitive:
 *
 *   Minutes: min, mins, minute, minutes
 *   Hours:   h, hr, hrs, hour, hours
 *   Days:    d, day, days
 *   Weeks:   w, wk, wks, week, weeks
 *   Months:  m, mo, mos, mon, mons, month, months
 *   Years:   y, yr, yrs, year, years
 *
 * The single-letter alias "m" always means calendar month. Minutes require
 * "min" or a longer minute alias. This deliberately favors the longer and safer
 * retention period when a user chooses the ambiguous single letter.
 *
 * Labels are discovered dynamically every time the script runs. You can create,
 * rename, or remove retention-period labels without changing this code. For
 * example, Retention/45mins, Retention/36 hours, Retention/45 days, and
 * Retention/3years all work automatically on the next run.
 *
 * IMPORTANT BEHAVIOR
 * ------------------
 * 1. Gmail labels apply to an entire conversation/thread, not one isolated
 *    message. The policy therefore applies to every active message in the
 *    conversation. Messages already in Trash are skipped rather than causing
 *    the remaining active messages in the conversation to be skipped.
 *
 * 2. The retention clock starts from the newest message in the conversation.
 *    A new reply resets the clock for the entire conversation.
 *
 * 3. When multiple retention labels exist, the script calculates the actual
 *    expiration timestamp for each policy from the newest message date. The
 *    policy producing the latest expiration wins, even when the labels use
 *    different units. For example, Retention/45d outlasts Retention/1m
 *    and therefore wins. All shorter or equivalent labels are removed so only
 *    one active retention label remains and the Gmail UI is unambiguous.
 *
 * 4. Minutes and hours use elapsed-time arithmetic. Days and weeks use
 *    calendar-day arithmetic. Months and years use calendar arithmetic rather
 *    than fixed 30-day or 365-day approximations. Month/year dates are clamped
 *    when necessary; for example, one month after January 31 becomes the last
 *    valid day of February.
 *
 * 5. Removing the retention label is the opt-out mechanism. A conversation with
 *    no valid retention label is ignored by the script.
 *
 * 6. Expired conversations are moved to Gmail Trash, not permanently deleted.
 *    Gmail handles final deletion from Trash under its normal Trash behavior.
 *
 * 7. After deleting ordinary messages, the script emails the user an HTML table
 *    listing every message moved to Trash. Each subject links directly to the
 *    conversation under Gmail's Trash route.
 *
 * 8. Summary notifications receive the policy configured by
 *    NOTIFICATION_RETENTION_LABEL_SUFFIX (1d by default) and are marked with the
 *    temporary internal child label configured by SYSTEM_NOTIFICATION_LABEL_SUFFIX.
 *    Both are created beneath ROOT_LABEL automatically when needed. When a
 *    notification is moved to Trash, its internal and retention labels are
 *    removed; if no active notifications remain, the internal label itself is
 *    deleted. Notifications are never included in another summary, preventing
 *    an endless delete-notify-delete loop.
 *
 * 9. When CHECK_FOR_UPDATES is enabled, every retention run checks the latest
 *    published GitHub release. Deletion summaries and the private admin page
 *    link directly to a newer release for manual installation. If a run has no
 *    deletion summary, one update-only email is sent per newer release. Results
 *    are cached for up to six hours, and lookup failures never interrupt Gmail
 *    retention or notification delivery.
 *
 * 10. ARCHIVE_ON_LABEL is disabled by default. When enabled, each scan removes
 *     the Inbox label from directly retention-labeled messages that are not yet
 *     expired. This is performed at message level so unrelated messages in a
 *     mixed conversation are not archived. This option requires the advanced
 *     Gmail service. Disabling it stops future archiving but does not return
 *     previously archived messages to Inbox.
 *
 * FIRST-RUN LABELS
 * ----------------
 * At the beginning of each run, the script checks whether the configured root
 * label exists. If it does not, the script creates the root label plus these two
 * starter retention-policy labels and verifies all three:
 *
 * With the default configuration, the starter set is:
 *
 *   Retention
 *   Retention/7d
 *   Retention/1m
 *
 * If the configured root label already exists, the script does not create or
 * recreate any retention sublabels. This gives new users a starting point while
 * preserving each user's intentionally customized label structure.
 *
 * VERBOSE DIAGNOSTICS
 * -------------------
 * Set the saved VERBOSE_LOGGING setting to true and run
 * diagnoseGmailRetentionLabels() to troubleshoot label creation without
 * processing any mail. The log records raw and normalized label names, direct
 * and scanned lookup results, createLabel() calls, verification retries, parsed
 * policies, and the Gmail account/session context. After troubleshooting, set
 * VERBOSE_LOGGING back to false because logs can contain mailbox metadata.
 *
 * INSTALLATION
 * ------------
 * - Paste this file into a standalone Google Apps Script project.
 * - Run enforceGmailRetention() manually once and approve permissions, including
 *   external-request access used for the optional GitHub update check.
 * - Add a time-driven trigger for enforceGmailRetention(), typically once daily.
 * - Create Gmail filters that apply labels such as Retention/7d or Retention/1m.
 */

/*
 * Factory defaults are copied into Script Properties on the first run. They are
 * never used in place of an existing saved configuration, so source updates do
 * not overwrite a user's active settings.
 */
const RETENTION_FACTORY_DEFAULTS = Object.freeze({
  /*
   * Set to true while diagnosing installation or label-processing problems.
   * Verbose mode logs nearly every material decision, including raw Gmail label
   * names, normalized names, creation attempts, thread IDs, policy comparisons,
   * and notification actions. Because logs may contain mailbox metadata such as
   * subjects and label names, turn this back off after troubleshooting.
   */
  VERBOSE_LOGGING: false,

  // Top-level label containing all user-configurable retention policies.
  ROOT_LABEL: 'Retention',

  // Remove directly retention-labeled messages from Inbox on the next scan.
  ARCHIVE_ON_LABEL: false,

  // Child-label values created only when ROOT_LABEL does not exist at all.
  DEFAULT_RETENTION_LABEL_SUFFIXES: Object.freeze(['7d', '1m']),

  // Notification subject format: "[Gmail Retention] 3 messages deleted".
  NOTIFICATION_SUBJECT_PREFIX: '[Gmail Retention]',

  // Child-label value applied to system emails before silent Trash cleanup.
  // Any supported retention expression can be used, such as '12h' or '7 days'.
  NOTIFICATION_RETENTION_LABEL_SUFFIX: '1d',

  // Temporary child label used only for system emails generated by this script.
  SYSTEM_NOTIFICATION_LABEL_SUFFIX: '_System',

  // Check the latest published GitHub release during each retention run.
  CHECK_FOR_UPDATES: true,
});

/*
 * Active settings are stored as one versioned JSON object under this property.
 * Keeping the schema version independent from the application version allows
 * settings migrations without tying them to a particular software release.
 */
const RETENTION_SETTINGS_PROPERTY_KEY = 'GMAIL_RETENTION_CONFIG';
const RETENTION_SETTINGS_SCHEMA_VERSION = 2;
const RETENTION_SETTINGS_BACKUPS_PROPERTY_KEY =
  'GMAIL_RETENTION_CONFIG_BACKUPS';
const RETENTION_SETTINGS_BACKUP_STORE_SCHEMA_VERSION = 1;
const RETENTION_SETTINGS_BACKUP_EXPORT_SCHEMA_VERSION = 1;
const RETENTION_SETTINGS_BACKUP_EXPORT_TYPE =
  'gmail-retention-manager-settings-backup';
const RETENTION_SETTINGS_BACKUP_LIMIT = 5;
const RETENTION_SETTINGS_BACKUP_IMPORT_MAX_CHARACTERS = 100000;
const RETENTION_SETTINGS_BACKUP_REASONS = Object.freeze([
  'settings_change',
  'restore',
  'import',
  'factory_reset',
  'application_update',
]);
const RETENTION_RUNTIME_STATE_PROPERTY_KEY = 'GMAIL_RETENTION_RUNTIME_STATE';
const RETENTION_RUNTIME_STATE_SCHEMA_VERSION = 1;
const RETENTION_UPDATE_CHECK_CACHE_SCHEMA_VERSION = 2;
const RETENTION_UPDATE_NOTIFICATION_STATE_PROPERTY_KEY =
  'GMAIL_RETENTION_UPDATE_NOTIFICATION_STATE';
const RETENTION_UPDATE_NOTIFICATION_STATE_SCHEMA_VERSION = 1;
const RETENTION_UPDATE_NOTIFICATION_HISTORY_LIMIT = 25;
const RETENTION_ADMIN_PREFERENCES_PROPERTY_KEY =
  'GMAIL_RETENTION_ADMIN_PREFERENCES';
const RETENTION_ADMIN_PREFERENCES_SCHEMA_VERSION = 1;
const RETENTION_ADMIN_FACTORY_PREFERENCES = Object.freeze({
  theme: 'dark',
});
const RETENTION_SCHEDULE_PROPERTY_KEY = 'GMAIL_RETENTION_SCHEDULE';
const RETENTION_SCHEDULE_SCHEMA_VERSION = 1;
const RETENTION_SCHEDULE_HANDLER = 'enforceGmailRetention';
const RETENTION_SCHEDULE_DEFAULT_FREQUENCY = 'daily';
const RETENTION_SCHEDULE_DEFAULT_DAILY_TIME = '07:00';
const RETENTION_SCHEDULE_FREQUENCIES = Object.freeze({
  every_15_minutes: Object.freeze({
    label: 'Every 15 minutes',
    unit: 'minutes',
    interval: 15,
  }),
  every_30_minutes: Object.freeze({
    label: 'Every 30 minutes',
    unit: 'minutes',
    interval: 30,
  }),
  every_hour: Object.freeze({
    label: 'Every hour',
    unit: 'hours',
    interval: 1,
  }),
  every_2_hours: Object.freeze({
    label: 'Every 2 hours',
    unit: 'hours',
    interval: 2,
  }),
  every_4_hours: Object.freeze({
    label: 'Every 4 hours',
    unit: 'hours',
    interval: 4,
  }),
  every_6_hours: Object.freeze({
    label: 'Every 6 hours',
    unit: 'hours',
    interval: 6,
  }),
  every_12_hours: Object.freeze({
    label: 'Every 12 hours',
    unit: 'hours',
    interval: 12,
  }),
  daily: Object.freeze({
    label: 'Daily',
    unit: 'days',
    interval: 1,
  }),
});

/*
 * These values control application behavior but are not user preferences. They
 * remain immutable source-code constants and are replaced during an update.
 */
const RETENTION_CONFIG = Object.freeze({

  // Displayed in notification footers and linked to the matching GitHub release.
  VERSION: '0.6.0',
  PROJECT_REPOSITORY_URL:
    'https://github.com/dynamiccookies/gmail-retention-manager',

  // Cache GitHub release results to reduce external requests. Apps Script allows
  // a maximum cache duration of 21,600 seconds (six hours).
  UPDATE_CHECK_CACHE_SECONDS: 21600,

  // Message-level Inbox removal uses the advanced Gmail service because Apps
  // Script's built-in archive methods operate only on entire conversations.
  ARCHIVE_LIST_PAGE_SIZE: 500,
  ARCHIVE_BATCH_SIZE: 500,

  // Ambiguous "m" intentionally means month. Minutes require min/mins/minute(s).
  UNIT_ALIASES: Object.freeze({
    min: 'min', mins: 'min', minute: 'min', minutes: 'min',
    h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
    d: 'd', day: 'd', days: 'd',
    w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w',
    m: 'm', mo: 'm', mos: 'm', mon: 'm', mons: 'm', month: 'm', months: 'm',
    y: 'y', yr: 'y', yrs: 'y', year: 'y', years: 'y',
  }),

  // Gmail Apps Script methods are safest when processed in moderate batches.
  THREAD_PAGE_SIZE: 100,
  // Active messages are moved individually so mixed Inbox/Trash conversations
  // do not lose their remaining active messages during retention enforcement.
  TRASH_BATCH_SIZE: 100,

  // Large deletion runs are split into multiple complete summary messages.
  MAX_ROWS_PER_NOTIFICATION: 200,

  // Prevent overlapping manual and scheduled executions from processing twice.
  LOCK_TIMEOUT_MS: 5000,
});

/* Cached only for the current Apps Script execution. */
let retentionSettingsCache = null;

/** @return {Object} A mutable copy of the immutable factory defaults. */
function copyFactoryRetentionSettings() {
  return {
    ...RETENTION_FACTORY_DEFAULTS,
    DEFAULT_RETENTION_LABEL_SUFFIXES: [
      ...RETENTION_FACTORY_DEFAULTS.DEFAULT_RETENTION_LABEL_SUFFIXES,
    ],
  };
}

/**
 * Returns a detached copy so callers cannot mutate the execution cache.
 *
 * @param {Object} settings Validated retention settings.
 * @return {Object} Mutable detached settings.
 */
function copyRetentionSettings(settings) {
  return {
    ...settings,
    DEFAULT_RETENTION_LABEL_SUFFIXES: [
      ...settings.DEFAULT_RETENTION_LABEL_SUFFIXES,
    ],
  };
}

/**
 * Freezes the settings cached during one execution.
 *
 * @param {Object} settings Validated retention settings.
 * @return {Object} Immutable settings.
 */
function freezeRetentionSettings(settings) {
  return Object.freeze({
    ...settings,
    DEFAULT_RETENTION_LABEL_SUFFIXES: Object.freeze([
      ...settings.DEFAULT_RETENTION_LABEL_SUFFIXES,
    ]),
  });
}

/** @return {boolean} Whether a value is a plain configuration object. */
function isConfigurationObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalizes and validates a Gmail label path or managed child-label suffix.
 *
 * @param {*} value Candidate value.
 * @param {string} settingName Configuration field name.
 * @return {string} Normalized nonempty path.
 */
function validateLabelPathSetting(value, settingName) {
  if (typeof value !== 'string') {
    throw new Error(`${settingName} must be a string.`);
  }

  const normalized = normalizeRetentionLabelName(value)
    .replace(/^\/+|\/+$/g, '');

  if (!normalized || normalized.split('/').some(segment => !segment.trim())) {
    throw new Error(`${settingName} must contain a valid Gmail label name.`);
  }

  return normalized;
}

/**
 * Normalizes and validates a supported retention-duration suffix.
 *
 * @param {*} value Candidate suffix such as "1d" or "2 weeks".
 * @param {string} settingName Configuration field name.
 * @return {string} Normalized suffix.
 */
function validateRetentionDurationSetting(value, settingName) {
  if (typeof value !== 'string') {
    throw new Error(`${settingName} must be a string.`);
  }

  const normalized = normalizeRetentionLabelName(value);
  const match = normalized.match(/^(\d+)\s*([a-z]+)$/i);
  const amount = match ? Number(match[1]) : NaN;
  const unitAlias = match ? match[2].toLowerCase() : '';

  if (
    !match ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !RETENTION_CONFIG.UNIT_ALIASES[unitAlias]
  ) {
    throw new Error(
      `${settingName} must be a positive supported retention duration.`,
    );
  }

  return normalized;
}

/**
 * Validates every user-editable setting and returns a normalized copy.
 * Invalid stored data is rejected rather than silently replaced with defaults.
 *
 * @param {*} settings Candidate settings object.
 * @return {Object} Validated and normalized settings.
 */
function validateRetentionSettings(settings) {
  if (!isConfigurationObject(settings)) {
    throw new Error('settings must be an object.');
  }

  const expectedKeys = Object.keys(RETENTION_FACTORY_DEFAULTS);
  const missingKeys = expectedKeys.filter(
    key => !Object.prototype.hasOwnProperty.call(settings, key),
  );
  const unknownKeys = Object.keys(settings).filter(
    key => !Object.prototype.hasOwnProperty.call(RETENTION_FACTORY_DEFAULTS, key),
  );

  if (missingKeys.length > 0) {
    throw new Error(`settings is missing: ${missingKeys.join(', ')}.`);
  }
  if (unknownKeys.length > 0) {
    throw new Error(`settings contains unknown fields: ${unknownKeys.join(', ')}.`);
  }
  if (typeof settings.VERBOSE_LOGGING !== 'boolean') {
    throw new Error('VERBOSE_LOGGING must be true or false.');
  }
  if (typeof settings.CHECK_FOR_UPDATES !== 'boolean') {
    throw new Error('CHECK_FOR_UPDATES must be true or false.');
  }
  if (typeof settings.ARCHIVE_ON_LABEL !== 'boolean') {
    throw new Error('ARCHIVE_ON_LABEL must be true or false.');
  }
  if (!Array.isArray(settings.DEFAULT_RETENTION_LABEL_SUFFIXES)) {
    throw new Error('DEFAULT_RETENTION_LABEL_SUFFIXES must be an array.');
  }
  if (typeof settings.NOTIFICATION_SUBJECT_PREFIX !== 'string') {
    throw new Error('NOTIFICATION_SUBJECT_PREFIX must be a string.');
  }

  const rootLabel = validateLabelPathSetting(
    settings.ROOT_LABEL,
    'ROOT_LABEL',
  );
  const defaultSuffixes = settings.DEFAULT_RETENTION_LABEL_SUFFIXES.map(
    (suffix, index) => validateRetentionDurationSetting(
      suffix,
      `DEFAULT_RETENTION_LABEL_SUFFIXES[${index}]`,
    ),
  );
  const duplicateSuffixes = defaultSuffixes.filter(
    (suffix, index) => defaultSuffixes.findIndex(
      candidate => candidate.toLowerCase() === suffix.toLowerCase(),
    ) !== index,
  );

  if (duplicateSuffixes.length > 0) {
    throw new Error('DEFAULT_RETENTION_LABEL_SUFFIXES cannot contain duplicates.');
  }

  const notificationRetentionSuffix = validateRetentionDurationSetting(
    settings.NOTIFICATION_RETENTION_LABEL_SUFFIX,
    'NOTIFICATION_RETENTION_LABEL_SUFFIX',
  );
  const systemNotificationSuffix = validateLabelPathSetting(
    settings.SYSTEM_NOTIFICATION_LABEL_SUFFIX,
    'SYSTEM_NOTIFICATION_LABEL_SUFFIX',
  );

  if (/^\d+\s*[a-z]+$/i.test(systemNotificationSuffix)) {
    const match = systemNotificationSuffix.match(/^(\d+)\s*([a-z]+)$/i);
    if (match && RETENTION_CONFIG.UNIT_ALIASES[match[2].toLowerCase()]) {
      throw new Error(
        'SYSTEM_NOTIFICATION_LABEL_SUFFIX cannot also be a retention duration.',
      );
    }
  }

  return {
    VERBOSE_LOGGING: settings.VERBOSE_LOGGING,
    ROOT_LABEL: rootLabel,
    ARCHIVE_ON_LABEL: settings.ARCHIVE_ON_LABEL,
    DEFAULT_RETENTION_LABEL_SUFFIXES: defaultSuffixes,
    NOTIFICATION_SUBJECT_PREFIX: settings.NOTIFICATION_SUBJECT_PREFIX.trim(),
    NOTIFICATION_RETENTION_LABEL_SUFFIX: notificationRetentionSuffix,
    SYSTEM_NOTIFICATION_LABEL_SUFFIX: systemNotificationSuffix,
    CHECK_FOR_UPDATES: settings.CHECK_FOR_UPDATES,
  };
}

/**
 * Extracts known setting fields from a schema-zero configuration. Schema zero
 * represents an early flat object or an object with an unversioned settings key.
 *
 * @param {Object} source Legacy settings.
 * @return {Object} Known setting fields only.
 */
function extractLegacyRetentionSettings(source) {
  const extracted = {};

  for (const key of Object.keys(RETENTION_FACTORY_DEFAULTS)) {
    extracted[key] = source[key];
  }

  return extracted;
}

/**
 * Migrates a stored configuration to the current independent schema version.
 * Each future schema must add an explicit migration step before the version is
 * incremented; configurations created by newer code are never downgraded.
 *
 * @param {*} storedConfiguration Parsed Script Property value.
 * @return {{configuration: Object, migrated: boolean}} Current configuration.
 */
function migrateRetentionConfiguration(storedConfiguration) {
  if (!isConfigurationObject(storedConfiguration)) {
    throw new Error('the stored configuration must be an object.');
  }

  let configuration = storedConfiguration;
  let schemaVersion = configuration.schemaVersion;
  let migrated = false;

  if (schemaVersion === undefined) {
    schemaVersion = 0;
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new Error('schemaVersion must be a nonnegative integer.');
  }
  if (schemaVersion > RETENTION_SETTINGS_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion ${schemaVersion} requires a newer application version.`,
    );
  }

  while (schemaVersion < RETENTION_SETTINGS_SCHEMA_VERSION) {
    switch (schemaVersion) {
      case 0: {
        const legacySettings = isConfigurationObject(configuration.settings)
          ? configuration.settings
          : configuration;
        configuration = {
          schemaVersion: 1,
          settings: extractLegacyRetentionSettings(legacySettings),
        };
        schemaVersion = 1;
        migrated = true;
        break;
      }
      case 1: {
        configuration = {
          schemaVersion: 2,
          settings: {
            ...configuration.settings,
            ARCHIVE_ON_LABEL: false,
          },
        };
        schemaVersion = 2;
        migrated = true;
        break;
      }
      default:
        throw new Error(`no migration exists for schemaVersion ${schemaVersion}.`);
    }
  }

  if (!isConfigurationObject(configuration.settings)) {
    throw new Error('the stored configuration must contain a settings object.');
  }

  return { configuration, migrated };
}

/**
 * Writes a validated versioned configuration to Script Properties.
 *
 * @param {Object} settings Candidate active settings.
 * @return {Object} Detached validated settings.
 */
function saveRetentionSettings(settings) {
  const validatedSettings = validateRetentionSettings(settings);
  const storedConfiguration = {
    schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
    settings: copyRetentionSettings(validatedSettings),
  };

  PropertiesService.getScriptProperties().setProperty(
    RETENTION_SETTINGS_PROPERTY_KEY,
    JSON.stringify(storedConfiguration),
  );
  retentionSettingsCache = freezeRetentionSettings(validatedSettings);

  return copyRetentionSettings(retentionSettingsCache);
}

/**
 * Loads active settings, initializes a missing property from factory defaults,
 * and persists successful schema migrations. Corrupt values are never reset or
 * overwritten automatically.
 *
 * @return {Object} Immutable active settings for the current execution.
 */
function getRetentionSettings() {
  if (retentionSettingsCache) {
    return retentionSettingsCache;
  }

  const scriptProperties = PropertiesService.getScriptProperties();
  const storedValue = scriptProperties.getProperty(
    RETENTION_SETTINGS_PROPERTY_KEY,
  );

  if (storedValue === null) {
    const factorySettings = validateRetentionSettings(
      copyFactoryRetentionSettings(),
    );
    saveRetentionSettings(factorySettings);
    console.log(
      `Initialized ${RETENTION_SETTINGS_PROPERTY_KEY} from factory defaults.`,
    );
    return retentionSettingsCache;
  }

  let parsedConfiguration;
  try {
    parsedConfiguration = JSON.parse(storedValue);
  } catch (error) {
    throw new Error(
      `Invalid ${RETENTION_SETTINGS_PROPERTY_KEY}: the stored value is not ` +
      `valid JSON (${error.message}). No Gmail changes were made.`,
    );
  }

  try {
    const migration = migrateRetentionConfiguration(parsedConfiguration);
    const validatedSettings = validateRetentionSettings(
      migration.configuration.settings,
    );
    retentionSettingsCache = freezeRetentionSettings(validatedSettings);

    if (migration.migrated) {
      createRetentionSettingsBackupFromConfiguration(
        'application_update',
        parsedConfiguration,
      );
      scriptProperties.setProperty(
        RETENTION_SETTINGS_PROPERTY_KEY,
        JSON.stringify({
          schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
          settings: copyRetentionSettings(validatedSettings),
        }),
      );
      console.log(
        `Migrated ${RETENTION_SETTINGS_PROPERTY_KEY} to schema ` +
          `${RETENTION_SETTINGS_SCHEMA_VERSION}.`,
      );
    }

    return retentionSettingsCache;
  } catch (error) {
    throw new Error(
      `Invalid ${RETENTION_SETTINGS_PROPERTY_KEY}: ${error.message} ` +
      'The saved value was not changed and no Gmail changes were made.',
    );
  }
}

/**
 * Returns the versioned active configuration for the admin interface.
 *
 * @return {{schemaVersion: number, settings: Object}} Detached configuration.
 */
function getRetentionConfiguration() {
  return {
    schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
    settings: copyRetentionSettings(getRetentionSettings()),
  };
}

/** @return {Object} Empty bounded backup store. */
function createEmptyRetentionSettingsBackupStore() {
  return {
    schemaVersion: RETENTION_SETTINGS_BACKUP_STORE_SCHEMA_VERSION,
    backups: [],
    invalidCount: 0,
    storageError: null,
  };
}

/**
 * Validates one backup and normalizes its restorable configuration.
 *
 * @param {*} candidate Candidate backup record.
 * @return {Object} Validated detached backup.
 */
function validateRetentionSettingsBackup(candidate) {
  if (!isConfigurationObject(candidate)) {
    throw new Error('backup record must be an object.');
  }
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    throw new Error('backup ID must be a nonempty string.');
  }
  if (
    typeof candidate.createdAt !== 'string' ||
    Number.isNaN(new Date(candidate.createdAt).getTime())
  ) {
    throw new Error('backup timestamp must be a valid date.');
  }
  if (
    candidate.importedAt !== undefined &&
    candidate.importedAt !== null &&
    (
      typeof candidate.importedAt !== 'string' ||
      Number.isNaN(new Date(candidate.importedAt).getTime())
    )
  ) {
    throw new Error('backup import timestamp must be a valid date.');
  }
  if (
    typeof candidate.applicationVersion !== 'string' ||
    !candidate.applicationVersion.trim()
  ) {
    throw new Error('backup application version must be a nonempty string.');
  }
  if (!RETENTION_SETTINGS_BACKUP_REASONS.includes(candidate.reason)) {
    throw new Error('backup reason is not supported.');
  }
  if (
    !Number.isInteger(candidate.configurationSchemaVersion) ||
    candidate.configurationSchemaVersion < 0
  ) {
    throw new Error('backup configuration schema version is invalid.');
  }
  if (
    !isConfigurationObject(candidate.configuration) ||
    candidate.configuration.schemaVersion !==
      candidate.configurationSchemaVersion
  ) {
    throw new Error('backup configuration metadata does not match its payload.');
  }

  const migration = migrateRetentionConfiguration(candidate.configuration);
  const validatedSettings = validateRetentionSettings(
    migration.configuration.settings,
  );

  return {
    id: candidate.id.trim(),
    createdAt: new Date(candidate.createdAt).toISOString(),
    importedAt: candidate.importedAt
      ? new Date(candidate.importedAt).toISOString()
      : null,
    reason: candidate.reason,
    applicationVersion: candidate.applicationVersion.trim(),
    configurationSchemaVersion: candidate.configurationSchemaVersion,
    configuration: {
      schemaVersion: candidate.configurationSchemaVersion,
      settings: copyRetentionSettings(validatedSettings),
    },
  };
}

/** @return {number} Timestamp used to order retained backups. */
function getRetentionSettingsBackupSortTime(backup) {
  return new Date(backup.importedAt || backup.createdAt).getTime();
}

/**
 * Reads and validates the rolling backup store. A fully corrupted store is
 * reported to the admin page but blocks writes so recoverable data is not
 * silently overwritten. Individual invalid records are omitted and reported.
 *
 * @param {boolean=} strict Whether storage errors should be thrown.
 * @return {Object} Valid backup store plus diagnostics.
 */
function getRetentionSettingsBackupStore(strict) {
  const storedValue = PropertiesService.getScriptProperties().getProperty(
    RETENTION_SETTINGS_BACKUPS_PROPERTY_KEY,
  );

  if (storedValue === null) {
    return createEmptyRetentionSettingsBackupStore();
  }

  try {
    const parsed = JSON.parse(storedValue);
    if (
      !isConfigurationObject(parsed) ||
      parsed.schemaVersion !== RETENTION_SETTINGS_BACKUP_STORE_SCHEMA_VERSION ||
      !Array.isArray(parsed.backups)
    ) {
      throw new Error('unsupported or missing backup-store schema.');
    }

    const backups = [];
    let invalidCount = 0;
    parsed.backups.forEach(candidate => {
      try {
        backups.push(validateRetentionSettingsBackup(candidate));
      } catch (error) {
        invalidCount += 1;
        console.error(`Ignoring invalid settings backup: ${error.message}`);
      }
    });
    backups.sort(
      (first, second) =>
        getRetentionSettingsBackupSortTime(second) -
          getRetentionSettingsBackupSortTime(first),
    );

    return {
      schemaVersion: RETENTION_SETTINGS_BACKUP_STORE_SCHEMA_VERSION,
      backups: backups.slice(0, RETENTION_SETTINGS_BACKUP_LIMIT),
      invalidCount,
      storageError: null,
    };
  } catch (error) {
    const message =
      `Invalid ${RETENTION_SETTINGS_BACKUPS_PROPERTY_KEY}: ${error.message}`;
    if (strict) {
      throw new Error(`${message} Active settings were not changed.`);
    }
    console.error(message);
    return {
      ...createEmptyRetentionSettingsBackupStore(),
      storageError: message,
    };
  }
}

/**
 * Replaces the backup store with at most the newest five validated records.
 *
 * @param {Array<Object>} backups Candidate backup records.
 * @return {Array<Object>} Saved records.
 */
function saveRetentionSettingsBackupStore(backups) {
  const validatedBackups = backups
    .map(validateRetentionSettingsBackup)
    .sort(
      (first, second) =>
        getRetentionSettingsBackupSortTime(second) -
          getRetentionSettingsBackupSortTime(first),
    )
    .slice(0, RETENTION_SETTINGS_BACKUP_LIMIT);

  PropertiesService.getScriptProperties().setProperty(
    RETENTION_SETTINGS_BACKUPS_PROPERTY_KEY,
    JSON.stringify({
      schemaVersion: RETENTION_SETTINGS_BACKUP_STORE_SCHEMA_VERSION,
      backups: validatedBackups,
    }),
  );

  return validatedBackups;
}

/**
 * Captures the current active retention settings before a mutating operation.
 * Future import, reset, and updater workflows must call this same function.
 *
 * @param {string} reason Supported operation about to change the settings.
 * @return {Object} Newly created backup.
 */
function createRetentionSettingsBackup(reason) {
  return createRetentionSettingsBackupFromConfiguration(
    reason,
    getRetentionConfiguration(),
  );
}

/**
 * Captures a supplied stored configuration without loading active settings.
 * This allows schema migration to preserve the pre-migration value without
 * recursively calling getRetentionSettings().
 *
 * @param {string} reason Supported operation about to change the settings.
 * @param {Object} configuration Versioned or legacy stored configuration.
 * @return {Object} Newly created backup.
 */
function createRetentionSettingsBackupFromConfiguration(reason, configuration) {
  if (!RETENTION_SETTINGS_BACKUP_REASONS.includes(reason)) {
    throw new Error(`Unsupported settings-backup reason: ${reason}.`);
  }
  if (!isConfigurationObject(configuration)) {
    throw new Error('Settings backup configuration must be an object.');
  }

  const store = getRetentionSettingsBackupStore(true);
  const schemaVersion = configuration.schemaVersion === undefined
    ? 0
    : configuration.schemaVersion;
  const versionedConfiguration = configuration.schemaVersion === undefined
    ? {
        schemaVersion: 0,
        settings: isConfigurationObject(configuration.settings)
          ? configuration.settings
          : extractLegacyRetentionSettings(configuration),
      }
    : configuration;
  const backup = validateRetentionSettingsBackup({
    id: Utilities.getUuid(),
    createdAt: new Date().toISOString(),
    reason,
    applicationVersion: RETENTION_CONFIG.VERSION,
    configurationSchemaVersion: schemaVersion,
    configuration: versionedConfiguration,
  });

  saveRetentionSettingsBackupStore([backup, ...store.backups]);
  return backup;
}

/**
 * Returns backup metadata and settings previews for the private admin page.
 *
 * @return {Object} Backup list and storage diagnostics.
 */
function getRetentionSettingsBackupsForAdmin() {
  const store = getRetentionSettingsBackupStore(false);
  let warning = store.storageError;

  if (!warning && store.invalidCount > 0) {
    warning = `${store.invalidCount} invalid settings backup` +
      `${store.invalidCount === 1 ? ' was' : 's were'} ignored. ` +
      'Active settings were not changed.';
  }

  return {
    limit: RETENTION_SETTINGS_BACKUP_LIMIT,
    warning,
    invalidCount: store.invalidCount,
    items: store.backups.map(backup => ({
      id: backup.id,
      createdAt: backup.createdAt,
      importedAt: backup.importedAt,
      reason: backup.reason,
      applicationVersion: backup.applicationVersion,
      configurationSchemaVersion: backup.configurationSchemaVersion,
      settings: copyRetentionSettings(backup.configuration.settings),
    })),
  };
}

/**
 * Resolves one currently retained backup and revalidates it before use.
 *
 * @param {string} backupId Requested backup ID.
 * @return {Object} Validated backup.
 */
function getRetentionSettingsBackupById(backupId) {
  if (typeof backupId !== 'string' || !backupId.trim()) {
    throw new Error('Select a valid settings backup.');
  }

  const store = getRetentionSettingsBackupStore(true);
  const backup = store.backups.find(item => item.id === backupId.trim());
  if (!backup) {
    throw new Error(
      'The selected settings backup is invalid, unavailable, or no longer retained.',
    );
  }

  return validateRetentionSettingsBackup(backup);
}

/**
 * Validates and adds a downloaded backup file to the rolling backup list. The
 * import does not change active settings; the user must review and restore it.
 *
 * @param {Object} request JSON file contents.
 * @return {Object} Refreshed backups and imported backup ID.
 */
function importRetentionSettingsBackupFromAdmin(request) {
  assertAdminOwnerAccess();

  if (
    !isConfigurationObject(request) ||
    typeof request.content !== 'string' ||
    !request.content.trim()
  ) {
    throw new Error('Select a valid Gmail Retention Manager backup file.');
  }
  if (request.content.length > RETENTION_SETTINGS_BACKUP_IMPORT_MAX_CHARACTERS) {
    throw new Error('The selected backup file is unexpectedly large.');
  }

  let parsed;
  try {
    parsed = JSON.parse(request.content);
  } catch (error) {
    throw new Error(`The selected backup file is not valid JSON: ${error.message}`);
  }

  if (
    !isConfigurationObject(parsed) ||
    parsed.fileType !== RETENTION_SETTINGS_BACKUP_EXPORT_TYPE ||
    parsed.exportSchemaVersion !==
      RETENTION_SETTINGS_BACKUP_EXPORT_SCHEMA_VERSION
  ) {
    throw new Error(
      'The selected file is not a supported Gmail Retention Manager backup.',
    );
  }

  const importedSource = validateRetentionSettingsBackup(parsed.backup);
  const importedBackup = validateRetentionSettingsBackup({
    ...importedSource,
    id: Utilities.getUuid(),
    importedAt: new Date().toISOString(),
  });
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error(
      'Another retention operation is active. Wait for it to finish and try again.',
    );
  }

  try {
    const store = getRetentionSettingsBackupStore(true);
    saveRetentionSettingsBackupStore([importedBackup, ...store.backups]);
    return {
      backups: getRetentionSettingsBackupsForAdmin(),
      importedBackupId: importedBackup.id,
      importedAt: importedBackup.importedAt,
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Permanently removes one retained backup without changing active settings.
 *
 * @param {Object} request Backup ID and explicit confirmation.
 * @return {Object} Refreshed backup list.
 */
function deleteRetentionSettingsBackupFromAdmin(request) {
  assertAdminOwnerAccess();

  if (
    !isConfigurationObject(request) ||
    request.confirmDelete !== true ||
    typeof request.backupId !== 'string' ||
    !request.backupId.trim()
  ) {
    throw new Error('Confirm which settings backup should be deleted.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error(
      'Another retention operation is active. Wait for it to finish and try again.',
    );
  }

  try {
    const store = getRetentionSettingsBackupStore(true);
    const backupId = request.backupId.trim();
    if (!store.backups.some(backup => backup.id === backupId)) {
      throw new Error('The selected settings backup is no longer available.');
    }

    saveRetentionSettingsBackupStore(
      store.backups.filter(backup => backup.id !== backupId),
    );
    return {
      backups: getRetentionSettingsBackupsForAdmin(),
      deletedBackupId: backupId,
      deletedAt: new Date().toISOString(),
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Validates preferences that affect only the administration interface.
 * Keeping them separate prevents display choices from affecting retention jobs.
 *
 * @param {*} preferences Candidate admin preferences.
 * @return {{theme: string}} Validated preferences.
 */
function validateRetentionAdminPreferences(preferences) {
  if (!isConfigurationObject(preferences)) {
    throw new Error('admin preferences must be an object.');
  }

  if (!['dark', 'light'].includes(preferences.theme)) {
    throw new Error('admin theme must be dark or light.');
  }

  return { theme: preferences.theme };
}

/**
 * Persists private admin-interface preferences in Script Properties.
 *
 * @param {Object} preferences Candidate preferences.
 * @return {{theme: string}} Saved preferences.
 */
function saveRetentionAdminPreferences(preferences) {
  const validated = validateRetentionAdminPreferences(preferences);
  const storedPreferences = {
    schemaVersion: RETENTION_ADMIN_PREFERENCES_SCHEMA_VERSION,
    preferences: validated,
  };

  PropertiesService.getScriptProperties().setProperty(
    RETENTION_ADMIN_PREFERENCES_PROPERTY_KEY,
    JSON.stringify(storedPreferences),
  );

  return { ...validated };
}

/**
 * Loads admin preferences and initializes or repairs the noncritical theme
 * preference with the dark factory default when necessary.
 *
 * @return {{theme: string}} Saved or default preferences.
 */
function getRetentionAdminPreferences() {
  const storedValue = PropertiesService.getScriptProperties().getProperty(
    RETENTION_ADMIN_PREFERENCES_PROPERTY_KEY,
  );

  if (storedValue === null) {
    return saveRetentionAdminPreferences(
      RETENTION_ADMIN_FACTORY_PREFERENCES,
    );
  }

  try {
    const storedPreferences = JSON.parse(storedValue);

    if (
      !isConfigurationObject(storedPreferences) ||
      storedPreferences.schemaVersion !==
        RETENTION_ADMIN_PREFERENCES_SCHEMA_VERSION
    ) {
      throw new Error('unsupported or missing admin-preference schema');
    }

    return validateRetentionAdminPreferences(storedPreferences.preferences);
  } catch (error) {
    console.error(
      `Resetting invalid ${RETENTION_ADMIN_PREFERENCES_PROPERTY_KEY}: ` +
        `${error.message}`,
    );
    return saveRetentionAdminPreferences(
      RETENTION_ADMIN_FACTORY_PREFERENCES,
    );
  }
}

/** @return {string} Valid default time zone for a new schedule. */
function getDefaultRetentionScheduleTimeZone() {
  const scriptTimeZone = Session.getScriptTimeZone();

  try {
    return validateRetentionScheduleTimeZone(scriptTimeZone);
  } catch (error) {
    console.error(
      `Invalid Apps Script project time zone ${scriptTimeZone}: ${error.message}`,
    );
    return 'Etc/UTC';
  }
}

/** @return {Object} Default schedule for a new or not-yet-managed installation. */
function createDefaultRetentionScheduleConfiguration() {
  return {
    schemaVersion: RETENTION_SCHEDULE_SCHEMA_VERSION,
    configured: false,
    preferences: {
      enabled: true,
      frequency: RETENTION_SCHEDULE_DEFAULT_FREQUENCY,
      dailyTime: RETENTION_SCHEDULE_DEFAULT_DAILY_TIME,
      timeZone: getDefaultRetentionScheduleTimeZone(),
    },
    managedTriggerId: null,
    updatedAt: null,
    configurationError: null,
  };
}

/**
 * Validates an IANA time zone by asking Apps Script to format a date with it.
 *
 * @param {*} value Candidate time zone.
 * @return {string} Validated time-zone name.
 */
function validateRetentionScheduleTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new Error('schedule time zone must be a valid time-zone name.');
  }

  const timeZone = value.trim();
  try {
    Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd HH:mm z');
  } catch (error) {
    throw new Error(`${timeZone} is not a supported time zone.`);
  }

  return timeZone;
}

/**
 * Validates the user-controlled portion of the retention schedule.
 *
 * @param {*} preferences Candidate schedule preferences.
 * @return {Object} Normalized preferences.
 */
function validateRetentionSchedulePreferences(preferences) {
  if (!isConfigurationObject(preferences)) {
    throw new Error('schedule preferences must be an object.');
  }

  const expectedKeys = ['enabled', 'frequency', 'dailyTime', 'timeZone'];
  const missingKeys = expectedKeys.filter(
    key => !Object.prototype.hasOwnProperty.call(preferences, key),
  );
  const unknownKeys = Object.keys(preferences).filter(
    key => !expectedKeys.includes(key),
  );

  if (missingKeys.length > 0) {
    throw new Error(`schedule preferences are missing: ${missingKeys.join(', ')}.`);
  }
  if (unknownKeys.length > 0) {
    throw new Error(
      `schedule preferences contain unknown fields: ${unknownKeys.join(', ')}.`,
    );
  }
  if (typeof preferences.enabled !== 'boolean') {
    throw new Error('schedule enabled must be true or false.');
  }
  if (!Object.prototype.hasOwnProperty.call(
    RETENTION_SCHEDULE_FREQUENCIES,
    preferences.frequency,
  )) {
    throw new Error('schedule frequency is not supported.');
  }
  if (
    typeof preferences.dailyTime !== 'string' ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(preferences.dailyTime)
  ) {
    throw new Error('daily schedule time must use 24-hour HH:MM format.');
  }

  return {
    enabled: preferences.enabled,
    frequency: preferences.frequency,
    dailyTime: preferences.dailyTime,
    timeZone: validateRetentionScheduleTimeZone(preferences.timeZone),
  };
}

/**
 * Loads schedule preferences and managed-trigger identity. Invalid schedule
 * metadata never prevents a manual Gmail retention scan.
 *
 * @return {Object} Detached schedule configuration.
 */
function getRetentionScheduleConfiguration() {
  const storedValue = PropertiesService.getScriptProperties().getProperty(
    RETENTION_SCHEDULE_PROPERTY_KEY,
  );

  if (storedValue === null) {
    return createDefaultRetentionScheduleConfiguration();
  }

  try {
    const parsed = JSON.parse(storedValue);

    if (
      !isConfigurationObject(parsed) ||
      parsed.schemaVersion !== RETENTION_SCHEDULE_SCHEMA_VERSION
    ) {
      throw new Error('unsupported or missing schedule schema');
    }
    if (typeof parsed.configured !== 'boolean') {
      throw new Error('configured must be true or false');
    }
    if (
      parsed.managedTriggerId !== null &&
      (typeof parsed.managedTriggerId !== 'string' || !parsed.managedTriggerId)
    ) {
      throw new Error('managedTriggerId must be null or a nonempty string');
    }
    if (
      parsed.updatedAt !== null &&
      (typeof parsed.updatedAt !== 'string' ||
        Number.isNaN(new Date(parsed.updatedAt).getTime()))
    ) {
      throw new Error('updatedAt must be null or a valid timestamp');
    }

    return {
      schemaVersion: RETENTION_SCHEDULE_SCHEMA_VERSION,
      configured: parsed.configured,
      preferences: validateRetentionSchedulePreferences(parsed.preferences),
      managedTriggerId: parsed.managedTriggerId,
      updatedAt: parsed.updatedAt,
      configurationError: null,
    };
  } catch (error) {
    console.error(
      `Ignoring invalid ${RETENTION_SCHEDULE_PROPERTY_KEY}: ${error.message}`,
    );
    return {
      ...createDefaultRetentionScheduleConfiguration(),
      configurationError:
        'The saved schedule metadata is invalid and must be replaced.',
    };
  }
}

/**
 * Persists validated schedule preferences and operational trigger identity.
 *
 * @param {Object} preferences User-controlled schedule preferences.
 * @param {?string} managedTriggerId Current managed trigger ID.
 * @return {Object} Saved schedule configuration.
 */
function saveRetentionScheduleConfiguration(preferences, managedTriggerId) {
  const validatedPreferences = validateRetentionSchedulePreferences(preferences);

  if (
    managedTriggerId !== null &&
    (typeof managedTriggerId !== 'string' || !managedTriggerId)
  ) {
    throw new Error('managed trigger ID must be null or a nonempty string.');
  }

  const configuration = {
    schemaVersion: RETENTION_SCHEDULE_SCHEMA_VERSION,
    configured: true,
    preferences: validatedPreferences,
    managedTriggerId,
    updatedAt: new Date().toISOString(),
  };

  PropertiesService.getScriptProperties().setProperty(
    RETENTION_SCHEDULE_PROPERTY_KEY,
    JSON.stringify(configuration),
  );

  return {
    ...configuration,
    preferences: { ...validatedPreferences },
    configurationError: null,
  };
}

/** @return {string} Time zone used for schedules and user-facing timestamps. */
function getConfiguredRetentionTimeZone() {
  const configuration = getRetentionScheduleConfiguration();
  return configuration.configurationError
    ? getDefaultRetentionScheduleTimeZone()
    : configuration.preferences.timeZone;
}

/** @return {Array} Time-driven triggers that call the retention entry point. */
function getRetentionClockTriggers() {
  return ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === RETENTION_SCHEDULE_HANDLER &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK,
  );
}

/**
 * Creates an Apps Script trigger from validated schedule preferences.
 *
 * @param {Object} preferences Validated enabled schedule preferences.
 * @return {Trigger} Newly created trigger.
 */
function createManagedRetentionTrigger(preferences) {
  const definition = RETENTION_SCHEDULE_FREQUENCIES[preferences.frequency];
  let builder = ScriptApp.newTrigger(RETENTION_SCHEDULE_HANDLER).timeBased();

  if (definition.unit === 'minutes') {
    return builder.everyMinutes(definition.interval).create();
  }
  if (definition.unit === 'hours') {
    return builder.everyHours(definition.interval).create();
  }

  const [hour, minute] = preferences.dailyTime.split(':').map(Number);
  builder = builder
    .atHour(hour)
    .nearMinute(minute)
    .everyDays(1)
    .inTimezone(preferences.timeZone);
  return builder.create();
}

/** @return {Object} Empty operational state for a new installation. */
function createDefaultRetentionRuntimeState() {
  return {
    schemaVersion: RETENTION_RUNTIME_STATE_SCHEMA_VERSION,
    lastRunStatus: 'never',
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastSuccessfulRunAt: null,
    lastSuccessfulResult: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastResult: null,
  };
}

/**
 * Loads internal dashboard state without allowing corrupt status data to block
 * Gmail retention. User settings remain subject to the stricter validation path.
 *
 * @return {Object} Detached runtime state.
 */
function getRetentionRuntimeState() {
  const storedValue = PropertiesService.getScriptProperties().getProperty(
    RETENTION_RUNTIME_STATE_PROPERTY_KEY,
  );

  if (storedValue === null) {
    return createDefaultRetentionRuntimeState();
  }

  try {
    const parsed = JSON.parse(storedValue);

    if (
      !isConfigurationObject(parsed) ||
      parsed.schemaVersion !== RETENTION_RUNTIME_STATE_SCHEMA_VERSION
    ) {
      throw new Error('unsupported or missing runtime-state schema');
    }

    return {
      ...createDefaultRetentionRuntimeState(),
      ...parsed,
      schemaVersion: RETENTION_RUNTIME_STATE_SCHEMA_VERSION,
    };
  } catch (error) {
    console.error(
      `Ignoring invalid ${RETENTION_RUNTIME_STATE_PROPERTY_KEY}: ` +
        `${error.message}`,
    );
    return createDefaultRetentionRuntimeState();
  }
}

/**
 * Updates the internal dashboard state. A status-write failure is logged but
 * never interrupts retention processing.
 *
 * @param {Object} changes Runtime-state fields to replace.
 */
function updateRetentionRuntimeStateSafely(changes) {
  try {
    const state = {
      ...getRetentionRuntimeState(),
      ...changes,
      schemaVersion: RETENTION_RUNTIME_STATE_SCHEMA_VERSION,
    };

    PropertiesService.getScriptProperties().setProperty(
      RETENTION_RUNTIME_STATE_PROPERTY_KEY,
      JSON.stringify(state),
    );
  } catch (error) {
    console.error(
      `Unable to update ${RETENTION_RUNTIME_STATE_PROPERTY_KEY}: ` +
        `${error && error.stack ? error.stack : error}`,
    );
  }
}

/** @return {string} Compact error text safe for persistent dashboard state. */
function getRuntimeErrorMessage(error) {
  const message = error && error.message ? error.message : String(error);
  return message.slice(0, 2000);
}

/**
 * Provides limited defense in depth in addition to the required owner-only web
 * app deployment. Some Apps Script execution contexts intentionally hide the
 * active user's email, so deployment access remains the authoritative control.
 *
 * @return {{ownerEmail: string, activeEmail: string}} Session identity details.
 */
function assertAdminOwnerAccess() {
  const ownerEmail = Session.getEffectiveUser().getEmail() || '';
  const activeEmail = Session.getActiveUser().getEmail() || '';

  if (
    ownerEmail &&
    activeEmail &&
    ownerEmail.toLowerCase() !== activeEmail.toLowerCase()
  ) {
    throw new Error('Access denied. This admin page is restricted to its owner.');
  }

  return { ownerEmail, activeEmail };
}

/**
 * Serves the private administration interface.
 *
 * @return {HtmlOutput} Admin webpage.
 */
function doGet() {
  assertAdminOwnerAccess();

  return HtmlService.createHtmlOutputFromFile('admin')
    .setTitle('Gmail Retention Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Returns verified schedule state. Apps Script cannot reveal the frequency of a
 * manually created trigger, so only a trigger ID recorded by this application
 * can be presented as managed.
 *
 * @return {Object} Trigger status and editable schedule preferences.
 */
function getRetentionTriggerStatus() {
  const configuration = getRetentionScheduleConfiguration();
  const matchingTriggers = getRetentionClockTriggers();
  const triggerCount = matchingTriggers.length;
  const managedTrigger = configuration.managedTriggerId
    ? matchingTriggers.find(
      trigger => trigger.getUniqueId() === configuration.managedTriggerId,
    ) || null
    : null;
  const unmanagedTriggerCount = managedTrigger
    ? triggerCount - 1
    : triggerCount;
  const frequencyOptions = Object.entries(RETENTION_SCHEDULE_FREQUENCIES).map(
    ([value, definition]) => ({
      value,
      label: definition.label,
      runsPerDay: definition.unit === 'minutes'
        ? 1440 / definition.interval
        : definition.unit === 'hours'
          ? 24 / definition.interval
          : 1,
    }),
  );
  const baseStatus = {
    configured: configuration.configured,
    configurationError: configuration.configurationError,
    preferences: { ...configuration.preferences },
    managedTriggerId: configuration.managedTriggerId,
    managed: Boolean(managedTrigger),
    triggerCount,
    unmanagedTriggerCount,
    frequencyOptions,
    updatedAt: configuration.updatedAt,
  };

  if (configuration.configurationError) {
    return {
      ...baseStatus,
      enabled: triggerCount > 0,
      status: 'warning',
      state: 'invalid_configuration',
      needsRepair: true,
      requiresExistingTriggerConfirmation: triggerCount > 0,
      summary: configuration.configurationError,
    };
  }

  if (managedTrigger && configuration.preferences.enabled) {
    if (unmanagedTriggerCount > 0) {
      return {
        ...baseStatus,
        enabled: true,
        status: 'warning',
        state: 'duplicate',
        needsRepair: true,
        requiresExistingTriggerConfirmation: true,
        summary:
          `${triggerCount} retention triggers were detected. Repair the ` +
          'schedule to remove the extra trigger(s).',
      };
    }

    return {
      ...baseStatus,
      enabled: true,
      status: 'enabled',
      state: 'managed',
      needsRepair: false,
      requiresExistingTriggerConfirmation: false,
      summary:
        `${RETENTION_SCHEDULE_FREQUENCIES[
          configuration.preferences.frequency
        ].label} retention schedule is active.`,
    };
  }

  if (triggerCount > 0) {
    return {
      ...baseStatus,
      enabled: true,
      status: 'warning',
      state: triggerCount > 1 ? 'duplicate' : 'unmanaged',
      needsRepair: triggerCount > 1,
      requiresExistingTriggerConfirmation: true,
      summary: triggerCount > 1
        ? `${triggerCount} retention triggers were detected. Choose the ` +
          'desired schedule and repair the duplicates.'
        : 'An existing retention trigger is active, but Apps Script does not ' +
          'expose its frequency. Replace it to manage the schedule here.',
    };
  }

  if (configuration.configured && configuration.preferences.enabled) {
    return {
      ...baseStatus,
      enabled: false,
      status: 'warning',
      state: 'missing',
      needsRepair: true,
      requiresExistingTriggerConfirmation: false,
      summary:
        'The saved schedule is enabled, but its managed trigger is missing.',
    };
  }

  if (!configuration.configured) {
    return {
      ...baseStatus,
      enabled: false,
      status: 'disabled',
      state: 'setup',
      needsRepair: false,
      requiresExistingTriggerConfirmation: false,
      summary:
        'Scheduled scans are not configured. Enable the default daily schedule below.',
    };
  }

  return {
    ...baseStatus,
    enabled: false,
    status: 'disabled',
    state: 'disabled',
    needsRepair: false,
    requiresExistingTriggerConfirmation: false,
    summary: 'Scheduled scans are disabled. Manual scans remain available.',
  };
}

/**
 * Loads all data required to render or refresh the admin page.
 *
 * @return {Object} Serializable admin-page data.
 */
function getAdminPageData() {
  const identity = assertAdminOwnerAccess();
  const trigger = getRetentionTriggerStatus();
  const availableUpdate = getAvailableUpdate();

  return {
    application: {
      name: 'Gmail Retention Manager',
      version: RETENTION_CONFIG.VERSION,
      repositoryUrl: RETENTION_CONFIG.PROJECT_REPOSITORY_URL,
      releasesUrl: `${RETENTION_CONFIG.PROJECT_REPOSITORY_URL}/releases`,
      currentReleaseUrl: getProjectReleaseUrl(),
      adminPageUrl: getAdminPageUrl(),
      availableUpdate,
      ownerEmail: identity.ownerEmail,
      timeZone: trigger.preferences.timeZone,
    },
    configurationSchemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
    settings: copyRetentionSettings(getRetentionSettings()),
    backups: getRetentionSettingsBackupsForAdmin(),
    adminPreferences: getRetentionAdminPreferences(),
    runtime: getRetentionRuntimeState(),
    trigger,
  };
}

/**
 * Saves the administration-page color theme independently from retention
 * settings so switching appearance never creates unsaved retention changes.
 *
 * @param {string} theme Requested dark or light theme.
 * @return {{theme: string}} Saved preference.
 */
function saveAdminTheme(theme) {
  assertAdminOwnerAccess();
  return saveRetentionAdminPreferences({ theme });
}

/**
 * Saves admin-page settings after server validation and confirmation of changes
 * that can orphan existing Gmail labels or filters.
 *
 * @param {Object} request Settings and risk acknowledgements from the webpage.
 * @return {Object} Saved settings and timestamp.
 */
function saveAdminPageSettings(request) {
  assertAdminOwnerAccess();

  if (!isConfigurationObject(request)) {
    throw new Error('The settings request must be an object.');
  }

  const validatedSettings = validateRetentionSettings(request.settings);
  const acknowledgements = isConfigurationObject(request.acknowledgements)
    ? request.acknowledgements
    : {};
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error(
      'Another retention operation is active. Wait for it to finish and try again.',
    );
  }

  let response;

  try {
    retentionSettingsCache = null;
    const currentSettings = getRetentionSettings();
    const rootChanged =
      validatedSettings.ROOT_LABEL !== currentSettings.ROOT_LABEL;
    const systemLabelChanged =
      validatedSettings.SYSTEM_NOTIFICATION_LABEL_SUFFIX !==
        currentSettings.SYSTEM_NOTIFICATION_LABEL_SUFFIX;

    if (rootChanged && acknowledgements.rootLabelChange !== true) {
      throw new Error(
        'Confirm that changing the root label does not rename existing Gmail ' +
        'labels or update Gmail filters.',
      );
    }
    if (systemLabelChanged && acknowledgements.systemLabelChange !== true) {
      throw new Error(
        'Confirm that changing the system-notification label may leave the old ' +
        'internal label behind.',
      );
    }

    createRetentionSettingsBackup('settings_change');
    response = {
      settings: saveRetentionSettings(validatedSettings),
      backups: getRetentionSettingsBackupsForAdmin(),
      savedAt: new Date().toISOString(),
    };
  } finally {
    lock.releaseLock();
  }

  response.availableUpdate = getAvailableUpdate();
  return response;
}

/**
 * Restores a validated backup after preserving the current active settings.
 * Existing Gmail labels and filters are never renamed as a side effect.
 *
 * @param {Object} request Backup ID and explicit acknowledgements.
 * @return {Object} Restored settings, refreshed backups, and timestamp.
 */
function restoreRetentionSettingsBackupFromAdmin(request) {
  assertAdminOwnerAccess();

  if (!isConfigurationObject(request) || request.confirmRestore !== true) {
    throw new Error('Confirm that the selected backup should be restored.');
  }

  const acknowledgements = isConfigurationObject(request.acknowledgements)
    ? request.acknowledgements
    : {};
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error(
      'Another retention operation is active. Wait for it to finish and try again.',
    );
  }

  let response;

  try {
    retentionSettingsCache = null;
    const backup = getRetentionSettingsBackupById(request.backupId);
    const migration = migrateRetentionConfiguration(backup.configuration);
    const restoredSettings = validateRetentionSettings(
      migration.configuration.settings,
    );
    const currentSettings = getRetentionSettings();
    const rootChanged =
      restoredSettings.ROOT_LABEL !== currentSettings.ROOT_LABEL;
    const systemLabelChanged =
      restoredSettings.SYSTEM_NOTIFICATION_LABEL_SUFFIX !==
        currentSettings.SYSTEM_NOTIFICATION_LABEL_SUFFIX;

    if (rootChanged && acknowledgements.rootLabelChange !== true) {
      throw new Error(
        'Confirm that restoring the root label does not rename existing Gmail ' +
        'labels or update Gmail filters.',
      );
    }
    if (systemLabelChanged && acknowledgements.systemLabelChange !== true) {
      throw new Error(
        'Confirm that restoring the system-notification label may leave the ' +
        'current internal label behind.',
      );
    }

    createRetentionSettingsBackup('restore');
    response = {
      settings: saveRetentionSettings(restoredSettings),
      backups: getRetentionSettingsBackupsForAdmin(),
      restoredBackupId: backup.id,
      restoredAt: new Date().toISOString(),
    };
  } finally {
    lock.releaseLock();
  }

  response.availableUpdate = getAvailableUpdate();
  return response;
}

/**
 * Compares normalized schedule preferences.
 *
 * @param {Object} first First preference object.
 * @param {Object} second Second preference object.
 * @return {boolean} Whether every preference matches.
 */
function retentionSchedulePreferencesEqual(first, second) {
  return Boolean(first && second) &&
    first.enabled === second.enabled &&
    first.frequency === second.frequency &&
    first.dailyTime === second.dailyTime &&
    first.timeZone === second.timeZone;
}

/**
 * Validates and applies one schedule operation while holding the script lock.
 * A replacement trigger is created and recorded before the prior trigger is
 * removed, preventing a failed creation from disabling a working schedule.
 *
 * @param {Object} request Schedule preferences and confirmations.
 * @param {boolean} repairOnly Whether this is an explicit repair action.
 * @return {Object} Refreshed trigger state and operation type.
 */
function applyRetentionScheduleFromAdmin(request, repairOnly) {
  assertAdminOwnerAccess();

  if (!isConfigurationObject(request)) {
    throw new Error('The schedule request must be an object.');
  }

  const preferences = validateRetentionSchedulePreferences(request.preferences);
  const confirmExistingTriggers = request.confirmExistingTriggers === true;
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error(
      'Another retention operation is active. Wait for it to finish and try again.',
    );
  }

  try {
    const beforeStatus = getRetentionTriggerStatus();
    const beforeConfiguration = getRetentionScheduleConfiguration();
    const existingTriggers = getRetentionClockTriggers();
    const managedTrigger = beforeConfiguration.managedTriggerId
      ? existingTriggers.find(
        trigger => trigger.getUniqueId() === beforeConfiguration.managedTriggerId,
      ) || null
      : null;

    if (
      beforeStatus.requiresExistingTriggerConfirmation &&
      !confirmExistingTriggers
    ) {
      throw new Error(
        'Confirm that Retention Manager may replace or remove the existing ' +
        'retention trigger(s).',
      );
    }

    if (
      repairOnly &&
      managedTrigger &&
      preferences.enabled &&
      retentionSchedulePreferencesEqual(
        preferences,
        beforeConfiguration.preferences,
      )
    ) {
      const extraTriggers = existingTriggers.filter(
        trigger => trigger.getUniqueId() !== managedTrigger.getUniqueId(),
      );
      extraTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

      return {
        action: 'repaired',
        trigger: getRetentionTriggerStatus(),
        savedAt: new Date().toISOString(),
      };
    }

    if (!preferences.enabled) {
      saveRetentionScheduleConfiguration(preferences, null);
      existingTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

      return {
        action: 'disabled',
        trigger: getRetentionTriggerStatus(),
        savedAt: new Date().toISOString(),
      };
    }

    let newTrigger = null;
    try {
      newTrigger = createManagedRetentionTrigger(preferences);
      saveRetentionScheduleConfiguration(
        preferences,
        newTrigger.getUniqueId(),
      );
    } catch (error) {
      if (newTrigger) {
        try {
          ScriptApp.deleteTrigger(newTrigger);
        } catch (cleanupError) {
          console.error(
            `Unable to remove failed replacement trigger: ${cleanupError.message}`,
          );
        }
      }
      throw error;
    }

    existingTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

    const action = repairOnly
      ? 'repaired'
      : beforeStatus.enabled
        ? 'updated'
        : 'enabled';

    return {
      action,
      trigger: getRetentionTriggerStatus(),
      savedAt: new Date().toISOString(),
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates, replaces, disables, or re-enables the managed retention schedule.
 *
 * @param {Object} request Schedule preferences and confirmations.
 * @return {Object} Refreshed trigger state.
 */
function saveRetentionScheduleFromAdmin(request) {
  return applyRetentionScheduleFromAdmin(request, false);
}

/**
 * Repairs a missing managed trigger or removes duplicate retention triggers.
 *
 * @param {Object} request Schedule preferences and confirmations.
 * @return {Object} Refreshed trigger state.
 */
function repairRetentionScheduleFromAdmin(request) {
  return applyRetentionScheduleFromAdmin(request, true);
}

/**
 * Runs retention from the admin page and returns refreshed operational data.
 *
 * @return {Object} Run result plus current runtime and trigger status.
 */
function runRetentionFromAdmin() {
  assertAdminOwnerAccess();
  const result = enforceGmailRetention();

  return {
    result,
    runtime: getRetentionRuntimeState(),
    trigger: getRetentionTriggerStatus(),
  };
}

/**
 * Returns the normalized configured root label and rejects an empty value.
 * The root may itself be nested, such as "Automation/Retention".
 *
 * @return {string} Normalized root-label path.
 */
function getRootLabelName() {
  const rootLabel = normalizeRetentionLabelName(getRetentionSettings().ROOT_LABEL)
    .replace(/^\/+|\/+$/g, '');

  if (!rootLabel) {
    throw new Error('ROOT_LABEL cannot be empty.');
  }

  return rootLabel;
}

/**
 * Builds a child label beneath the configured root label.
 *
 * @param {string} childName Child-label name or retention expression.
 * @return {string} Full Gmail label path.
 */
function buildManagedLabelName(childName) {
  const normalizedChild = normalizeRetentionLabelName(childName)
    .replace(/^\/+|\/+$/g, '');

  if (!normalizedChild) {
    throw new Error('Managed Gmail child-label names cannot be empty.');
  }

  return `${getRootLabelName()}/${normalizedChild}`;
}

/** @return {string[]} Full starter retention-label paths. */
function getDefaultRetentionLabelNames() {
  return getRetentionSettings().DEFAULT_RETENTION_LABEL_SUFFIXES.map(
    suffix => buildManagedLabelName(suffix),
  );
}

/** @return {string} Full retention label applied to system notifications. */
function getNotificationRetentionLabelName() {
  return buildManagedLabelName(
    getRetentionSettings().NOTIFICATION_RETENTION_LABEL_SUFFIX,
  );
}

/** @return {string} Full temporary system-notification label path. */
function getSystemNotificationLabelName() {
  return buildManagedLabelName(
    getRetentionSettings().SYSTEM_NOTIFICATION_LABEL_SUFFIX,
  );
}

/**
 * Builds the retention-label parser dynamically from ROOT_LABEL so changing the
 * configured root does not require changes elsewhere in the script.
 *
 * @return {RegExp} Case-insensitive retention-label pattern.
 */
function getRetentionLabelPattern() {
  return new RegExp(
    `^${escapeRegExp(getRootLabelName())}/(\\d+)\\s*([a-z]+)$`,
    'i',
  );
}

/** @return {string} GitHub release URL for the configured semantic version. */
function getProjectReleaseUrl() {
  return `${RETENTION_CONFIG.PROJECT_REPOSITORY_URL}/releases/tag/` +
    `v${encodeURIComponent(RETENTION_CONFIG.VERSION)}`;
}

/**
 * Returns the stable deployed admin-page URL when this project is a web app.
 * Missing deployment metadata must never prevent a retention notification.
 *
 * @return {string} Deployed web-app URL, or an empty string when unavailable.
 */
function getAdminPageUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    verboseLog(
      'ADMIN PAGE URL FAILURE',
      error && error.stack ? error.stack : String(error),
    );
    return '';
  }
}

/**
 * Extracts the GitHub owner and repository name from PROJECT_REPOSITORY_URL.
 *
 * @return {{owner: string, repository: string}} GitHub repository coordinates.
 */
function getGitHubRepositoryCoordinates() {
  const repositoryUrl = String(RETENTION_CONFIG.PROJECT_REPOSITORY_URL)
    .trim()
    .replace(/\/+$/, '');
  const match = repositoryUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?$/i,
  );

  if (!match) {
    throw new Error(
      'RETENTION_CONFIG.PROJECT_REPOSITORY_URL must use the format ' +
      'https://github.com/OWNER/REPOSITORY.',
    );
  }

  return {
    owner: match[1],
    repository: match[2],
  };
}

/** @return {string} GitHub REST endpoint for the latest published release. */
function getLatestReleaseApiUrl() {
  const coordinates = getGitHubRepositoryCoordinates();

  return 'https://api.github.com/repos/' +
    `${encodeURIComponent(coordinates.owner)}/` +
    `${encodeURIComponent(coordinates.repository)}/releases/latest`;
}

/** @return {string} Cache key unique to the repository and installed version. */
function getUpdateCheckCacheKey() {
  return `gmail-retention-update:v${RETENTION_UPDATE_CHECK_CACHE_SCHEMA_VERSION}:` +
    `${RETENTION_CONFIG.PROJECT_REPOSITORY_URL}:` +
    `${RETENTION_CONFIG.VERSION}`;
}

/**
 * Parses a semantic version with an optional leading "v", prerelease section,
 * and build metadata. Build metadata is ignored during precedence comparisons.
 *
 * @param {*} value Version or Git tag to parse.
 * @return {Object|null} Parsed semantic version, or null when invalid.
 */
function parseSemanticVersion(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );

  if (!match) {
    return null;
  }

  return {
    original: normalized,
    normalized: `${match[1]}.${match[2]}.${match[3]}` +
      (match[4] ? `-${match[4]}` : ''),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Compares two semantic versions according to SemVer precedence rules.
 *
 * @param {*} first First semantic version.
 * @param {*} second Second semantic version.
 * @return {number} Positive when first is newer, negative when older, or zero.
 */
function compareSemanticVersions(first, second) {
  const left = typeof first === 'object' && first !== null
    ? first
    : parseSemanticVersion(first);
  const right = typeof second === 'object' && second !== null
    ? second
    : parseSemanticVersion(second);

  if (!left || !right) {
    throw new Error(
      `Cannot compare invalid semantic versions: ${first} and ${second}`,
    );
  }

  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) {
      return left[field] > right[field] ? 1 : -1;
    }
  }

  const leftPrerelease = left.prerelease;
  const rightPrerelease = right.prerelease;

  if (leftPrerelease.length === 0 && rightPrerelease.length === 0) {
    return 0;
  }
  if (leftPrerelease.length === 0) {
    return 1;
  }
  if (rightPrerelease.length === 0) {
    return -1;
  }

  const identifierCount = Math.max(
    leftPrerelease.length,
    rightPrerelease.length,
  );

  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];

    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }

    const leftIsNumeric = /^\d+$/.test(leftIdentifier);
    const rightIsNumeric = /^\d+$/.test(rightIdentifier);

    if (leftIsNumeric && rightIsNumeric) {
      return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }

    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

/**
 * Retrieves and caches metadata for the latest published GitHub release.
 * GitHub's "latest release" endpoint excludes draft and prerelease releases.
 * Any network, rate-limit, repository, or parsing failure is intentionally
 * nonfatal and results in no update notice for the current notification.
 *
 * @return {{version: string, tagName: string, releaseUrl: string}|null}
 */
function getLatestPublishedRelease() {
  if (!getRetentionSettings().CHECK_FOR_UPDATES) {
    verboseLog('UPDATE CHECK', 'Disabled by configuration.');
    return null;
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = getUpdateCheckCacheKey();
  const cachedValue = cache.get(cacheKey);

  if (cachedValue) {
    try {
      const cachedResult = JSON.parse(cachedValue);
      verboseLog('UPDATE CHECK CACHE HIT', cachedResult);
      return cachedResult.release || null;
    } catch (error) {
      verboseLog('UPDATE CHECK CACHE PARSE FAILURE', String(error));
      cache.remove(cacheKey);
    }
  }

  try {
    const apiUrl = getLatestReleaseApiUrl();
    verboseLog('UPDATE CHECK REQUEST', apiUrl);

    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'get',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'gmail-retention-manager',
      },
      muteHttpExceptions: true,
      followRedirects: true,
      timeoutSeconds: 20,
    });
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    verboseLog('UPDATE CHECK RESPONSE', {
      responseCode,
      responsePreview: responseText.slice(0, 500),
    });

    if (responseCode !== 200) {
      console.warn(
        `GitHub update check returned HTTP ${responseCode}. The unsuccessful ` +
          'result was not cached and will be retried on the next check.',
      );
      return null;
    }

    const payload = JSON.parse(responseText);
    const parsedVersion = parseSemanticVersion(payload.tag_name);

    if (!parsedVersion || !payload.html_url) {
      console.warn('GitHub update check returned invalid release metadata.', {
        tagName: payload.tag_name,
        releaseUrl: payload.html_url,
      });
      return null;
    }

    const release = {
      version: parsedVersion.normalized,
      tagName: String(payload.tag_name),
      releaseUrl: String(payload.html_url),
    };

    cache.put(
      cacheKey,
      JSON.stringify({ release, responseCode }),
      RETENTION_CONFIG.UPDATE_CHECK_CACHE_SECONDS,
    );
    return release;
  } catch (error) {
    console.warn(
      'GitHub update check failed. The unsuccessful result was not cached and ' +
        `will be retried on the next check: ${
          error && error.message ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Returns the latest release only when it is newer than the installed version.
 * Invalid local or remote version strings suppress the notice rather than
 * interrupting email retention.
 *
 * @return {{version: string, tagName: string, releaseUrl: string}|null}
 */
function getAvailableUpdate() {
  try {
    const installedVersion = parseSemanticVersion(RETENTION_CONFIG.VERSION);
    const latestRelease = getLatestPublishedRelease();

    if (!installedVersion || !latestRelease) {
      return null;
    }

    const latestVersion = parseSemanticVersion(latestRelease.version);

    if (!latestVersion) {
      return null;
    }

    const comparison = compareSemanticVersions(
      latestVersion,
      installedVersion,
    );
    verboseLog('UPDATE CHECK COMPARISON', {
      installedVersion: installedVersion.normalized,
      latestVersion: latestVersion.normalized,
      comparison,
    });

    return comparison > 0 ? latestRelease : null;
  } catch (error) {
    verboseLog(
      'UPDATE CHECK COMPARISON FAILURE',
      error && error.stack ? error.stack : String(error),
    );
    return null;
  }
}

/** @return {Object} Empty release-announcement history. */
function createDefaultUpdateNotificationState() {
  return {
    schemaVersion: RETENTION_UPDATE_NOTIFICATION_STATE_SCHEMA_VERSION,
    announcements: [],
  };
}

/**
 * Loads the bounded list of releases already announced by email. Corrupt state
 * is ignored so update tracking cannot interrupt Gmail retention.
 *
 * @return {Object} Valid detached notification state.
 */
function getUpdateNotificationState() {
  const storedValue = PropertiesService.getScriptProperties().getProperty(
    RETENTION_UPDATE_NOTIFICATION_STATE_PROPERTY_KEY,
  );

  if (storedValue === null) {
    return createDefaultUpdateNotificationState();
  }

  try {
    const parsed = JSON.parse(storedValue);
    if (
      !isConfigurationObject(parsed) ||
      parsed.schemaVersion !==
        RETENTION_UPDATE_NOTIFICATION_STATE_SCHEMA_VERSION ||
      !Array.isArray(parsed.announcements)
    ) {
      throw new Error('unsupported or missing update-notification schema');
    }

    const announcements = parsed.announcements.filter(item =>
      isConfigurationObject(item) &&
      typeof item.version === 'string' &&
      Boolean(parseSemanticVersion(item.version)) &&
      typeof item.announcedAt === 'string' &&
      !Number.isNaN(new Date(item.announcedAt).getTime()),
    ).map(item => ({
      version: parseSemanticVersion(item.version).normalized,
      tagName: typeof item.tagName === 'string' ? item.tagName : '',
      releaseUrl: typeof item.releaseUrl === 'string' ? item.releaseUrl : '',
      announcedAt: new Date(item.announcedAt).toISOString(),
      source: item.source === 'summary' ? 'summary' : 'update_only',
    })).slice(0, RETENTION_UPDATE_NOTIFICATION_HISTORY_LIMIT);

    return {
      schemaVersion: RETENTION_UPDATE_NOTIFICATION_STATE_SCHEMA_VERSION,
      announcements,
    };
  } catch (error) {
    console.error(
      `Ignoring invalid ${RETENTION_UPDATE_NOTIFICATION_STATE_PROPERTY_KEY}: ` +
        `${error.message}`,
    );
    return createDefaultUpdateNotificationState();
  }
}

/**
 * Returns whether this release already received its dedicated update-only email.
 *
 * @param {Object} availableUpdate Newer GitHub release metadata.
 * @return {boolean} Whether its update-only email was already sent.
 */
function hasSentUpdateOnlyNotification(availableUpdate) {
  if (!availableUpdate || !parseSemanticVersion(availableUpdate.version)) {
    return false;
  }

  const normalizedVersion = parseSemanticVersion(
    availableUpdate.version,
  ).normalized;
  return getUpdateNotificationState().announcements.some(
    announcement => announcement.version === normalizedVersion &&
      announcement.source === 'update_only',
  );
}

/**
 * Records a release only after its dedicated update-only email is sent.
 * Keeping a short history prevents a release from being reannounced if GitHub's
 * latest-release pointer changes temporarily.
 *
 * @param {Object} availableUpdate Newer GitHub release metadata.
 */
function recordUpdateOnlyNotification(availableUpdate) {
  const parsedVersion = availableUpdate &&
    parseSemanticVersion(availableUpdate.version);
  if (!parsedVersion) {
    throw new Error('Cannot record an invalid update-only notification.');
  }

  const state = getUpdateNotificationState();
  const announcement = {
    version: parsedVersion.normalized,
    tagName: String(availableUpdate.tagName || ''),
    releaseUrl: String(availableUpdate.releaseUrl || ''),
    announcedAt: new Date().toISOString(),
    source: 'update_only',
  };
  const announcements = [
    announcement,
    ...state.announcements.filter(
      item => item.version !== announcement.version,
    ),
  ].slice(0, RETENTION_UPDATE_NOTIFICATION_HISTORY_LIMIT);

  PropertiesService.getScriptProperties().setProperty(
    RETENTION_UPDATE_NOTIFICATION_STATE_PROPERTY_KEY,
    JSON.stringify({
      schemaVersion: RETENTION_UPDATE_NOTIFICATION_STATE_SCHEMA_VERSION,
      announcements,
    }),
  );
}

/**
 * Compares Gmail label names after normalizing separators, spacing, and case.
 *
 * @param {*} first First label name.
 * @param {*} second Second label name.
 * @return {boolean} Whether both names identify the same label path.
 */
function labelNamesEqual(first, second) {
  return normalizeRetentionLabelName(first).toLowerCase() ===
    normalizeRetentionLabelName(second).toLowerCase();
}

/**
 * Escapes a string for safe interpolation into a regular expression.
 *
 * @param {*} value Value to escape.
 * @return {string} Regular-expression-safe text.
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Main entry point. Configure a daily time-driven trigger for this function.
 * The returned object is ignored by scheduled triggers and displayed by the
 * admin page after a manual run.
 *
 * @return {Object} Serializable outcome of the retention run.
 */
function enforceGmailRetention() {
  const startedAt = new Date();
  updateRetentionRuntimeStateSafely({
    lastRunStatus: 'running',
    lastRunStartedAt: startedAt.toISOString(),
    lastRunCompletedAt: null,
    lastResult: null,
  });

  try {
    const result = executeGmailRetention_();
    const completedAt = new Date();
    const completedResult = {
      ...result,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
    const stateChanges = {
      lastRunStatus: result.status,
      lastRunCompletedAt: completedAt.toISOString(),
      lastResult: completedResult,
    };

    if (result.status === 'success') {
      stateChanges.lastSuccessfulRunAt = completedAt.toISOString();
      stateChanges.lastSuccessfulResult = completedResult;
    }

    const operationErrors = Array.isArray(result.operationErrors)
      ? result.operationErrors.filter(
          message => typeof message === 'string' && message.trim(),
        )
      : [];
    if (operationErrors.length > 0) {
      stateChanges.lastErrorAt = completedAt.toISOString();
      stateChanges.lastErrorMessage = operationErrors.join(' ').slice(0, 2000);
    }

    updateRetentionRuntimeStateSafely(stateChanges);
    return completedResult;
  } catch (error) {
    const failedAt = new Date().toISOString();
    updateRetentionRuntimeStateSafely({
      lastRunStatus: 'error',
      lastRunCompletedAt: failedAt,
      lastErrorAt: failedAt,
      lastErrorMessage: getRuntimeErrorMessage(error),
      lastResult: null,
    });
    throw error;
  }
}

/** @return {Object} Core retention outcome before dashboard metadata is added. */
function executeGmailRetention_() {
  const settings = getRetentionSettings();
  verboseLog('MAIN', 'enforceGmailRetention() entered.');
  const lock = LockService.getScriptLock();
  verboseLog('LOCK', `Attempting script lock for ${RETENTION_CONFIG.LOCK_TIMEOUT_MS} ms.`);

  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    const reason = 'Another retention run is already active. This run was skipped.';
    console.log(reason);
    return {
      status: 'skipped',
      reason,
    };
  }

  try {
    verboseLog('LOCK', 'Script lock acquired.');
    const now = new Date();
    const availableUpdate = getAvailableUpdate();
    const effectiveUserEmail = Session.getEffectiveUser().getEmail();
    const activeUserEmail = Session.getActiveUser().getEmail();

    verboseLog('SESSION', {
      effectiveUserEmail,
      activeUserEmail,
      scriptTimeZone: Session.getScriptTimeZone(),
      now: now.toISOString(),
      config: {
        rootLabel: settings.ROOT_LABEL,
        defaultRetentionLabels: getDefaultRetentionLabelNames(),
        notificationRetentionLabel:
          getNotificationRetentionLabelName(),
        systemNotificationLabel:
          getSystemNotificationLabelName(),
        archiveOnLabel: settings.ARCHIVE_ON_LABEL,
      },
    });

    console.log(
      `Starting Gmail Retention Manager ${RETENTION_CONFIG.VERSION}` +
      `${effectiveUserEmail ? ` for ${effectiveUserEmail}` : ''}.`,
    );

    // Bootstrap starter labels before discovery so a brand-new installation does
    // not exit with "No valid retention labels" on its first authorized run.
    verboseLabelSnapshot('LABELS BEFORE INITIALIZATION');
    const initializedLabels = initializeDefaultRetentionLabels();
    verboseLog(
      'INITIALIZATION',
      `initializeDefaultRetentionLabels() returned ${initializedLabels.length} label(s).`,
    );
    verboseLabelSnapshot('LABELS AFTER INITIALIZATION');

    const discoveredRetentionLabels = discoverRetentionLabels(initializedLabels);
    verboseLog(
      'DISCOVERY',
      `Discovered ${discoveredRetentionLabels.length} valid retention policy label(s).`,
    );
    const systemNotificationLabel = GmailApp.getUserLabelByName(
      getSystemNotificationLabelName(),
    );

    verboseLog('SYSTEM LABEL LOOKUP', describeLabel(systemNotificationLabel));

    if (
      discoveredRetentionLabels.length === 0 &&
      !systemNotificationLabel
    ) {
      const updateOnlyEmailCount = sendUpdateOnlyNotificationIfNeeded(
        availableUpdate,
        now,
      );
      console.log(
        'No valid retention labels were found. Gmail retention had nothing to ' +
          `process. Sent ${updateOnlyEmailCount} update-only email(s).`,
      );
      return {
        status: 'success',
        reviewedConversationCount: 0,
        movedMessageCount: 0,
        movedConversationCount: 0,
        reportedMessageCount: 0,
        removedRetentionLabelCount: 0,
        archiveOnLabelEnabled: settings.ARCHIVE_ON_LABEL,
        archivedMessageCount: 0,
        archivedConversationCount: 0,
        archiveLookupFailureCount: 0,
        archiveFailedMessageCount: 0,
        operationErrors: [],
        summaryEmailCount: 0,
        updateOnlyEmailCount,
        availableUpdate,
      };
    }

    /*
     * A thread can be returned by several retention labels. System-notification
     * threads are collected separately as a recovery path in case their
     * configured notification-retention label was not applied during a prior
     * partially failed run.
     */
    verboseLog('THREAD COLLECTION', 'Beginning unique-thread collection.');
    const threadMap = collectUniqueThreads(
      discoveredRetentionLabels,
      systemNotificationLabel,
    );
    verboseLog('THREAD COLLECTION', `Collected ${threadMap.size} unique thread(s).`);
    const pendingDeletions = [];
    const excludedArchiveMessageIds = new Set();
    let removedRetentionLabelCount = 0;

    for (const thread of threadMap.values()) {
      verboseLog('THREAD', `Processing thread ${thread.getId()}.`);
      const threadLabels = thread.getLabels();
      const threadIsInTrash = thread.isInTrash();
      verboseLog('THREAD LABELS', {
        threadId: thread.getId(),
        labels: threadLabels.map(label => label.getName()),
        isInTrash: threadIsInTrash,
      });
      const isSystemNotification = threadLabels.some(
        label => labelNamesEqual(label.getName(), getSystemNotificationLabelName()),
      );

      const messages = thread.getMessages();
      const activeMessages = messages.filter(message => !message.isInTrash());
      if (isSystemNotification) {
        activeMessages.forEach(message => {
          excludedArchiveMessageIds.add(message.getId());
        });
      }
      verboseLog('THREAD MESSAGES', {
        threadId: thread.getId(),
        messageCount: messages.length,
        activeMessageCount: activeMessages.length,
        trashedMessageCount: messages.length - activeMessages.length,
        subjects: messages.map(message => message.getSubject() || '(no subject)'),
      });

      /*
       * A user may manually trash a generated summary before its configured
       * retention period expires. Clean its temporary labels immediately so it
       * is not rediscovered on every future run and so the internal label can be
       * deleted when unused. Message state is authoritative here because Gmail
       * can report a mixed Inbox/Trash conversation itself as being in Trash.
       */
      if (activeMessages.length === 0) {
        verboseLog('THREAD TRASH STATE', {
          threadId: thread.getId(),
          threadIsInTrash,
          isSystemNotification,
          action: isSystemNotification
            ? 'Remove temporary notification labels and skip'
            : 'Skip conversation with no active messages',
        });
        if (isSystemNotification) {
          removeSystemNotificationLabels(thread);
        }
        continue;
      }

      if (threadIsInTrash) {
        verboseLog('THREAD TRASH STATE', {
          threadId: thread.getId(),
          threadIsInTrash,
          activeMessageCount: activeMessages.length,
          action: 'Process active messages in mixed-state conversation',
        });
      }

      const newestMessage = getNewestMessage(messages);
      verboseLog('THREAD NEWEST MESSAGE', {
        threadId: thread.getId(),
        subject: newestMessage.getSubject() || '(no subject)',
        date: newestMessage.getDate().toISOString(),
      });

      let policies = threadLabels
        .map(label => parseRetentionLabel(label))
        .filter(policy => policy !== null);

      verboseLog('THREAD POLICIES', {
        threadId: thread.getId(),
        policies: policies.map(policy => ({
          labelName: policy.labelName,
          amount: policy.amount,
          unit: policy.unit,
        })),
      });

      /*
       * System notifications always use the configured notification-retention
       * policy, even if another Gmail filter accidentally adds a different
       * retention label. This also repairs an internal notification whose
       * required retention label is missing.
       */
      if (isSystemNotification) {
        policies = ensureSystemNotificationPolicy(thread, policies);
      }

      if (policies.length === 0) {
        // An ordinary thread's label may have been removed after discovery.
        continue;
      }

      const winningPolicy = chooseWinningPolicy(
        policies,
        newestMessage.getDate(),
        isSystemNotification,
      );

      verboseLog('WINNING POLICY', {
        threadId: thread.getId(),
        labelName: winningPolicy.labelName,
        expiresAt: winningPolicy.expiresAt.toISOString(),
        now: now.toISOString(),
      });

      // Keep exactly one valid retention label to eliminate conflicting UI state.
      for (const policy of policies) {
        if (policy.label.getId() !== winningPolicy.label.getId()) {
          verboseLog('REMOVE REDUNDANT LABEL', {
            threadId: thread.getId(),
            removedLabel: policy.labelName,
            retainedLabel: winningPolicy.labelName,
          });
          policy.label.removeFromThread(thread);
          removedRetentionLabelCount += 1;
        }
      }

      if (now.getTime() < winningPolicy.expiresAt.getTime()) {
        verboseLog('RETENTION DECISION', {
          threadId: thread.getId(),
          decision: 'KEEP',
          expiresAt: winningPolicy.expiresAt.toISOString(),
        });
        continue;
      }

      verboseLog('RETENTION DECISION', {
        threadId: thread.getId(),
        decision: 'MOVE_TO_TRASH',
        expiredAt: winningPolicy.expiresAt.toISOString(),
      });

      /*
       * Capture all message-level details before moving the thread to Trash.
       * The same permalink is used for every message because Gmail opens the
       * containing conversation, while sender/date/subject remain message-specific.
       */
      const messageRecords = isSystemNotification
        ? []
        : activeMessages.map(message => ({
            subject: message.getSubject() || '(no subject)',
            sender: message.getFrom() || '(unknown sender)',
            receivedAt: message.getDate(),
            retentionLabel: winningPolicy.labelName,
            trashPermalink: buildTrashPermalink(thread),
          }));

      pendingDeletions.push({
        thread,
        messagesToTrash: activeMessages,
        messageRecords,
        isSystemNotification,
      });
      activeMessages.forEach(message => {
        excludedArchiveMessageIds.add(message.getId());
      });
    }

    const archiveResult = settings.ARCHIVE_ON_LABEL
      ? archiveRetentionLabeledInboxMessages(
          discoveredRetentionLabels,
          excludedArchiveMessageIds,
        )
      : createEmptyArchiveResult();
    const deletionResult = movePendingMessagesToTrash(pendingDeletions);
    const deletedMessageRecords = deletionResult.deletedMessageRecords;

    // Delete the temporary internal label when no active notification uses it.
    deleteSystemNotificationLabelIfUnused();

    /*
     * Only ordinary deleted messages generate a notification. When the only
     * deletion is an expired system notification, no new notification is sent.
     */
    const summaryEmailCount = deletedMessageRecords.length > 0
      ? sendDeletionSummaries(deletedMessageRecords, now, availableUpdate)
      : 0;
    const updateOnlyEmailCount = deletedMessageRecords.length === 0
      ? sendUpdateOnlyNotificationIfNeeded(availableUpdate, now)
      : 0;

    const result = {
      status: 'success',
      reviewedConversationCount: threadMap.size,
      movedMessageCount: deletionResult.movedMessageCount,
      movedConversationCount: deletionResult.movedThreadCount,
      reportedMessageCount: deletedMessageRecords.length,
      removedRetentionLabelCount,
      archiveOnLabelEnabled: settings.ARCHIVE_ON_LABEL,
      archivedMessageCount: archiveResult.archivedMessageCount,
      archivedConversationCount: archiveResult.archivedConversationCount,
      archiveLookupFailureCount: archiveResult.lookupFailureCount,
      archiveFailedMessageCount: archiveResult.failedMessageCount,
      operationErrors: archiveResult.errors,
      summaryEmailCount,
      updateOnlyEmailCount,
      availableUpdate,
    };

    console.log([
      `Reviewed ${result.reviewedConversationCount} conversation(s).`,
      `Moved ${result.movedMessageCount} active message(s) to Trash ` +
        `from ${result.movedConversationCount} conversation(s).`,
      `Reported ${result.reportedMessageCount} deleted message(s).`,
      `Removed ${result.removedRetentionLabelCount} redundant retention label(s).`,
      settings.ARCHIVE_ON_LABEL
        ? `Archived ${result.archivedMessageCount} labeled Inbox message(s) ` +
          `from ${result.archivedConversationCount} conversation(s). ` +
          `Archive warnings: ${result.archiveLookupFailureCount} lookup ` +
          `failure(s), ${result.archiveFailedMessageCount} message move failure(s).`
        : 'Archive-on-label is disabled.',
      availableUpdate
        ? `Update v${availableUpdate.version} is available. ` +
          `Sent ${summaryEmailCount} summary email(s) and ` +
          `${updateOnlyEmailCount} update-only email(s).`
        : 'No newer published release was detected.',
    ].join(' '));

    return result;
  } catch (error) {
    console.error(
      `Gmail Retention Manager ${RETENTION_CONFIG.VERSION} failed: ` +
      `${error && error.stack ? error.stack : error}`,
    );
    throw error;
  } finally {
    verboseLog('LOCK', 'Releasing script lock.');
    lock.releaseLock();
    verboseLog('MAIN', 'enforceGmailRetention() exited.');
  }
}

/**
 * Creates a small starter label set only for a completely new installation.
 *
 * The existence check is intentionally limited to the configured root label.
 * Once that parent exists, this function never recreates missing sublabels,
 * because the user may have intentionally removed or replaced the defaults.
 *
 * @return {GmailLabel[]} Labels created during this run. Returns an empty array
 *   when the configured root label already exists.
 */
function initializeDefaultRetentionLabels() {
  verboseLog('INITIALIZATION', 'Checking whether starter labels are required.');
  const rootLabelName = getRootLabelName();
  const rootLabel = findUserLabelByName(rootLabelName);
  verboseLog('INITIALIZATION ROOT LOOKUP', describeLabel(rootLabel));

  if (rootLabel) {
    console.log(
      `The ${rootLabelName} label already exists; ` +
      'starter sublabels were not created.',
    );
    return [];
  }

  /*
   * Gmail represents nested labels by their full path. Create the configured
   * root first, followed by the two starter policy labels, then verify all three.
   */
  verboseLog(
    'INITIALIZATION',
    `No configured root label (${rootLabelName}) was found. ` +
      'Starter-label creation will begin.',
  );

  const requestedLabelNames = [
    rootLabelName,
    ...getDefaultRetentionLabelNames(),
  ];
  verboseLog('INITIALIZATION REQUESTED LABELS', requestedLabelNames);
  const createdLabels = requestedLabelNames.map(labelName => {
    verboseLog('INITIALIZATION CREATE', `Requesting label ${labelName}.`);
    const label = getOrCreateLabel(labelName);
    verboseLog('INITIALIZATION CREATE RESULT', describeLabel(label));
    return label;
  });

  /*
   * Verify the exact labels returned by Gmail. This converts a silent bootstrap
   * failure into an actionable error instead of allowing the run to continue
   * with "No valid retention labels".
   */
  verboseLabelSnapshot('LABELS BEFORE STARTER VERIFICATION');
  const missingLabelNames = requestedLabelNames.filter(labelName =>
    !createdLabels.some(
      label => normalizeRetentionLabelName(label.getName()).toLowerCase() ===
        normalizeRetentionLabelName(labelName).toLowerCase(),
    ),
  );

  if (missingLabelNames.length > 0) {
    throw new Error(
      'Gmail did not create the required starter label(s): ' +
      missingLabelNames.join(', '),
    );
  }

  console.log(`Created starter labels: ${requestedLabelNames.join(', ')}`);
  return createdLabels;
}

/**
 * Optional setup-only entry point. Run this manually when testing installation
 * or permissions. It creates the starter labels when appropriate and logs every
 * retention policy the script can currently recognize without processing mail.
 */
function setupGmailRetention() {
  verboseLog('SETUP', 'setupGmailRetention() entered.');
  const effectiveUserEmail = Session.getEffectiveUser().getEmail();
  console.log(
    `Setting up Gmail Retention Manager ${RETENTION_CONFIG.VERSION}` +
    `${effectiveUserEmail ? ` for ${effectiveUserEmail}` : ''}.`,
  );

  const initializedLabels = initializeDefaultRetentionLabels();
  const policies = discoverRetentionLabels(initializedLabels);
  const policyNames = policies.map(policy => policy.labelName);

  console.log(
    policyNames.length > 0
      ? `Recognized retention labels: ${policyNames.join(', ')}`
      : 'No valid retention labels were recognized after setup.',
  );
  verboseLabelSnapshot('SETUP FINAL LABEL SNAPSHOT');
  verboseLog('SETUP', 'setupGmailRetention() exited.');
}

/**
 * Diagnostic-only entry point. It performs setup and label discovery but never
 * reads, relabels, or trashes any Gmail conversation. Set VERBOSE_LOGGING to
 * true, save the project, and run this function while troubleshooting.
 */
function diagnoseGmailRetentionLabels() {
  console.log(
    `Starting label diagnostics for Gmail Retention Manager ` +
      `${RETENTION_CONFIG.VERSION}.`,
  );
  verboseLabelSnapshot('DIAGNOSTIC INITIAL LABEL SNAPSHOT');
  const initializedLabels = initializeDefaultRetentionLabels();
  const policies = discoverRetentionLabels(initializedLabels);
  verboseLabelSnapshot('DIAGNOSTIC FINAL LABEL SNAPSHOT');
  console.log(
    `Label diagnostics complete. Recognized ${policies.length} valid ` +
      `retention label(s): ${policies.map(policy => policy.labelName).join(', ') || '(none)'}.`,
  );
}

/**
 * Finds every user-created Gmail label matching the supported retention format.
 * This is what allows new retention periods to work without code changes.
 *
 * Labels created moments earlier are accepted as an optional argument. Including
 * them directly avoids depending on GmailApp.getUserLabels() reflecting new
 * labels immediately within the same execution.
 *
 * @param {GmailLabel[]} initializedLabels Labels created during this run.
 * @return {{label: GmailLabel, amount: number, unit: string, labelName: string}[]}
 */
function discoverRetentionLabels(initializedLabels = []) {
  verboseLog('DISCOVERY', {
    initializedLabelCount: initializedLabels.length,
    initializedLabels: initializedLabels.map(label => label.getName()),
  });
  const labelsByName = new Map();

  const gmailLabels = GmailApp.getUserLabels();
  verboseLog('DISCOVERY RAW GMAIL LABELS', gmailLabels.map(describeLabel));

  for (const label of [
    ...gmailLabels,
    ...initializedLabels,
  ]) {
    const normalizedName = normalizeRetentionLabelName(label.getName());
    verboseLog('DISCOVERY NORMALIZE LABEL', {
      rawName: label.getName(),
      normalizedName,
      id: safeGetLabelId(label),
    });
    labelsByName.set(normalizedName.toLowerCase(), label);
  }

  const allLabels = [...labelsByName.values()];
  verboseLog('DISCOVERY UNIQUE LABEL COUNT', allLabels.length);
  const policies = allLabels
    .map(label => parseRetentionLabel(label))
    .filter(policy => policy !== null);

  if (policies.length > 0) {
    console.log(
      `Recognized retention labels: ${policies
        .map(policy => policy.labelName)
        .join(', ')}`,
    );
  } else {
    const retentionLikeLabels = allLabels
      .map(label => label.getName())
      .filter(labelName =>
        normalizeRetentionLabelName(labelName)
          .toLowerCase()
          .startsWith(getRootLabelName().toLowerCase()),
      );

    console.log(
      retentionLikeLabels.length > 0
        ? 'No valid retention labels were found. Retention-like labels seen: ' +
          retentionLikeLabels.join(', ')
        : `No labels beginning with ${getRootLabelName()} were found.`,
    );
  }

  return policies;
}

/**
 * Parses a retention label and maps its unit alias to a canonical unit. Examples
 * include Retention/30d, Retention/30 days, Retention/2yr, and Retention/2 years
 * when the default root label is used.
 *
 * @param {GmailLabel} label Gmail label to inspect.
 * @return {{label: GmailLabel, amount: number, unit: string, labelName: string}|null}
 */
function parseRetentionLabel(label) {
  const labelName = label.getName();
  const normalizedLabelName = normalizeRetentionLabelName(labelName);
  const match = normalizedLabelName.match(getRetentionLabelPattern());

  if (!match) {
    verboseLog('PARSE LABEL', {
      labelName,
      normalizedLabelName,
      valid: false,
      reason: 'Does not match the configured root label and retention format',
    });
    return null;
  }

  const amount = Number(match[1]);
  const unitAlias = match[2].toLowerCase();
  const unit = RETENTION_CONFIG.UNIT_ALIASES[unitAlias];

  if (!unit) {
    verboseLog('PARSE LABEL', {
      labelName,
      normalizedLabelName,
      valid: false,
      reason: 'Unrecognized retention unit alias',
      unitAlias,
    });
    return null;
  }

  // Zero-length periods are intentionally rejected.
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    verboseLog('PARSE LABEL', {
      labelName,
      normalizedLabelName,
      valid: false,
      reason: 'Retention amount must be a positive safe integer',
      amount,
      unitAlias,
      unit,
    });
    return null;
  }

  verboseLog('PARSE LABEL', {
    labelName,
    normalizedLabelName,
    valid: true,
    amount,
    unitAlias,
    canonicalUnit: unit,
  });

  return {
    label,
    amount,
    unit,
    unitAlias,
    labelName,
    normalizedLabelName,
  };
}

/**
 * Converts supported alternative separators to Gmail's canonical forward slash,
 * removes accidental whitespace around the separator, and collapses repeated
 * internal whitespace. Labels such as Retention\3 minutes, Retention / 3min,
 * and Retention/3   days therefore normalize consistently.
 *
 * @param {*} value Label name or other text to normalize.
 * @return {string} Canonicalized label name.
 */
function normalizeRetentionLabelName(value) {
  return String(value)
    .trim()
    .replace(/[\\⁄∕／]/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
}

/**
 * Retrieves all threads attached to all discovered retention labels and removes
 * duplicate thread references caused by overlapping labels.
 *
 * @param {Array} retentionPolicies Discovered retention labels and metadata.
 * @param {GmailLabel|null} systemNotificationLabel Internal recovery label.
 * @return {Map<string, GmailThread>} Map keyed by Gmail thread ID.
 */
function collectUniqueThreads(retentionPolicies, systemNotificationLabel) {
  verboseLog('THREAD COLLECTION INPUT', {
    retentionPolicies: retentionPolicies.map(policy => policy.labelName),
    systemNotificationLabel: describeLabel(systemNotificationLabel),
  });
  const threadMap = new Map();

  for (const policy of retentionPolicies) {
    addLabelThreadsToMap(policy.label, threadMap);
  }

  if (systemNotificationLabel) {
    addLabelThreadsToMap(systemNotificationLabel, threadMap);
  }

  return threadMap;
}

/**
 * Adds every thread carrying one label to a shared deduplication map.
 *
 * @param {GmailLabel} label Gmail label to enumerate.
 * @param {Map<string, GmailThread>} threadMap Destination map.
 */
function addLabelThreadsToMap(label, threadMap) {
  let start = 0;
  verboseLog('LABEL THREAD ENUMERATION', {
    label: describeLabel(label),
    pageSize: RETENTION_CONFIG.THREAD_PAGE_SIZE,
  });

  while (true) {
    const threads = label.getThreads(
      start,
      RETENTION_CONFIG.THREAD_PAGE_SIZE,
    );

    verboseLog('LABEL THREAD PAGE', {
      labelName: label.getName(),
      start,
      returnedThreadCount: threads.length,
      threadIds: threads.map(thread => thread.getId()),
    });

    for (const thread of threads) {
      threadMap.set(thread.getId(), thread);
    }

    if (threads.length < RETENTION_CONFIG.THREAD_PAGE_SIZE) {
      break;
    }

    start += threads.length;
  }
}

/**
 * Returns the most recent message without assuming Gmail's array order.
 *
 * @param {GmailMessage[]} messages Messages in one Gmail conversation.
 * @return {GmailMessage} Most recent message.
 */
function getNewestMessage(messages) {
  return messages.reduce((newest, current) =>
    current.getDate().getTime() > newest.getDate().getTime()
      ? current
      : newest,
  );
}

/**
 * Ensures a system-generated notification has the configured notification
 * retention label. This also repairs a notification if that label was
 * accidentally removed while the internal system label remained.
 *
 * @param {GmailThread} thread Notification thread.
 * @param {Array} policies Existing parsed retention policies.
 * @return {Array} Updated policy list.
 */
function ensureSystemNotificationPolicy(thread, policies) {
  const requiredLabelName = getNotificationRetentionLabelName();
  const existingPolicy = policies.find(
    policy => labelNamesEqual(policy.labelName, requiredLabelName),
  );

  if (existingPolicy) {
    return policies;
  }

  const requiredLabel = getOrCreateLabel(requiredLabelName);
  requiredLabel.addToThread(thread);

  const parsedPolicy = parseRetentionLabel(requiredLabel);
  if (!parsedPolicy) {
    throw new Error(
      `The configured notification label is invalid: ${requiredLabelName}`,
    );
  }

  return [...policies, parsedPolicy];
}

/**
 * Selects the longest policy by calculating each policy's actual expiration date
 * from the newest message date. The latest expiration wins.
 *
 * For system notifications, the configured notification-retention policy is
 * forced to win so
 * accidental filter matches cannot change the configured notification lifecycle.
 *
 * @param {Array} policies Parsed retention policies on the thread.
 * @param {Date} newestMessageDate Date of the newest message in the thread.
 * @param {boolean} isSystemNotification Whether the thread is script-generated.
 * @return {Object} Winning policy including an expiresAt Date.
 */
function chooseWinningPolicy(
  policies,
  newestMessageDate,
  isSystemNotification,
) {
  verboseLog('POLICY COMPARISON INPUT', {
    newestMessageDate: newestMessageDate.toISOString(),
    isSystemNotification,
    policies: policies.map(policy => ({
      labelName: policy.labelName,
      amount: policy.amount,
      unit: policy.unit,
    })),
  });

  const evaluatedPolicies = policies.map(policy => ({
    ...policy,
    expiresAt: addRetentionPeriod(
      newestMessageDate,
      policy.amount,
      policy.unit,
    ),
  }));

  verboseLog('POLICY COMPARISON EVALUATED', evaluatedPolicies.map(policy => ({
    labelName: policy.labelName,
    amount: policy.amount,
    unit: policy.unit,
    expiresAt: policy.expiresAt.toISOString(),
  })));

  if (isSystemNotification) {
    const requiredLabelName = getNotificationRetentionLabelName();
    const requiredPolicy = evaluatedPolicies.find(
      policy => labelNamesEqual(policy.labelName, requiredLabelName),
    );

    if (!requiredPolicy) {
      throw new Error(
        'System notification is missing its configured retention policy.',
      );
    }

    verboseLog('POLICY COMPARISON WINNER', {
      labelName: requiredPolicy.labelName,
      expiresAt: requiredPolicy.expiresAt.toISOString(),
      reason: 'Configured system-notification policy is forced to win',
    });
    return requiredPolicy;
  }

  /*
   * Primary sort: latest calculated expiration timestamp. This is what makes
   * comparisons across different units accurate. For example, 45d is compared
   * directly with the calendar date produced by 1m rather than by assigning a
   * fixed number of days to a month.
   *
   * Tie-breakers: broader unit, then larger amount, then label name. Tie-breakers
   * apply only when two policies produce the exact same expiration timestamp and
   * ensure one stable label remains.
   */
  const tieBreakerUnitRank = { min: 1, h: 2, d: 3, w: 4, m: 5, y: 6 };

  evaluatedPolicies.sort((a, b) =>
    b.expiresAt.getTime() - a.expiresAt.getTime() ||
    tieBreakerUnitRank[b.unit] - tieBreakerUnitRank[a.unit] ||
    b.amount - a.amount ||
    a.labelName.localeCompare(b.labelName),
  );

  verboseLog('POLICY COMPARISON WINNER', {
    labelName: evaluatedPolicies[0].labelName,
    expiresAt: evaluatedPolicies[0].expiresAt.toISOString(),
  });
  return evaluatedPolicies[0];
}

/**
 * Adds a retention period using calendar-aware arithmetic.
 *
 * @param {Date} startDate Date from which retention begins.
 * @param {number} amount Positive integer amount.
 * @param {'min'|'h'|'d'|'w'|'m'|'y'} unit Retention unit.
 * @return {Date} Calculated expiration date.
 */
function addRetentionPeriod(startDate, amount, unit) {
  const result = new Date(startDate.getTime());
  verboseLog('ADD RETENTION PERIOD', {
    startDate: startDate.toISOString(),
    amount,
    unit,
  });

  switch (unit) {
    case 'min':
      return new Date(result.getTime() + amount * 60 * 1000);

    case 'h':
      return new Date(result.getTime() + amount * 60 * 60 * 1000);

    case 'd':
      result.setDate(result.getDate() + amount);
      return result;

    case 'w':
      result.setDate(result.getDate() + amount * 7);
      return result;

    case 'm':
      return addCalendarMonthsClamped(result, amount);

    case 'y':
      return addCalendarMonthsClamped(result, amount * 12);

    default:
      throw new Error(`Unsupported retention unit: ${unit}`);
  }
}

/**
 * Adds calendar months while clamping invalid dates to the target month's end.
 * Example: January 31 + 1 month becomes February 28 or February 29.
 *
 * @param {Date} startDate Starting date.
 * @param {number} monthCount Number of months to add.
 * @return {Date} Calendar-adjusted date.
 */
function addCalendarMonthsClamped(startDate, monthCount) {
  const result = new Date(startDate.getTime());
  const originalDay = result.getDate();

  // Move to day one before changing months to prevent JavaScript overflow.
  result.setDate(1);
  result.setMonth(result.getMonth() + monthCount);

  const lastDayOfTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();

  result.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

/**
 * Builds a Gmail URL that opens the conversation from the correct account's
 * Trash route.
 *
 * The numeric account path used by Gmail, such as /u/0/ or /u/5/, is assigned
 * by the user's current browser session and login order. Apps Script cannot
 * reliably determine that browser-specific number; getPermalink() may return
 * /u/0/ even when the same account is /u/5/ in the user's browser.
 *
 * To avoid linking to the wrong signed-in account, this function selects the
 * Gmail account by its email address through the authuser query parameter. It
 * then appends the Trash route and the immutable Gmail thread ID.
 *
 * Example:
 *   https://mail.google.com/mail/u/?authuser=user%40example.com#trash/THREAD_ID
 *
 * @param {GmailThread} thread Gmail conversation being moved to Trash.
 * @return {string} Gmail URL scoped to the owning account and Trash route.
 */
function buildTrashPermalink(thread) {
  const threadId = thread.getId();
  const accountEmail = getNotificationRecipient();
  const trashPermalink =
    'https://mail.google.com/mail/u/?authuser=' +
    `${encodeURIComponent(accountEmail)}#trash/${encodeURIComponent(threadId)}`;

  verboseLog('TRASH PERMALINK', {
    threadId,
    accountEmail,
    originalPermalink: String(thread.getPermalink() || ''),
    trashPermalink,
  });

  return trashPermalink;
}

/**
 * Formats a message count for notification subjects and other compact text.
 *
 * @param {number} count Number of deleted messages.
 * @return {string} Human-readable singular or plural message count.
 */
function formatMessageCount(count) {
  return `${count} ${count === 1 ? 'message' : 'messages'}`;
}

/**
 * Builds the notification subject shown in Gmail. The sent timestamp already
 * appears in Gmail, so the subject contains only the useful deletion count and
 * an optional part number for split reports.
 *
 * @param {number} totalMessageCount Total messages reported across all parts.
 * @param {number} partNumber Current notification part.
 * @param {number} totalParts Total notification parts.
 * @return {string} Notification subject.
 */
function buildNotificationSubject(
  totalMessageCount,
  partNumber,
  totalParts,
) {
  const partSuffix = totalParts > 1
    ? ` — part ${partNumber} of ${totalParts}`
    : '';
  const subjectBody = `${formatMessageCount(totalMessageCount)} deleted${partSuffix}`;

  return buildPrefixedNotificationSubject(subjectBody);
}

/**
 * Applies the configured prefix consistently to every generated system email.
 *
 * @param {string} subjectBody Subject text following the optional prefix.
 * @return {string} Complete notification subject.
 */
function buildPrefixedNotificationSubject(subjectBody) {
  const prefix = getRetentionSettings().NOTIFICATION_SUBJECT_PREFIX;
  return prefix ? `${prefix} ${subjectBody}` : subjectBody;
}

/** @return {string} Subject for a release-specific update-only email. */
function buildUpdateNotificationSubject(availableUpdate) {
  return buildPrefixedNotificationSubject(
    `v${availableUpdate.version} update available`,
  );
}

/** @return {Object} Empty message-level archive outcome. */
function createEmptyArchiveResult() {
  return {
    archivedMessageCount: 0,
    archivedConversationCount: 0,
    lookupFailureCount: 0,
    failedMessageCount: 0,
    errors: [],
  };
}

/**
 * Lists messages that directly carry one retention label and the Inbox system
 * label. Using the Gmail API avoids treating every message in a mixed thread as
 * though it carries the same user label.
 *
 * @param {string} labelId Gmail user-label ID.
 * @return {Array<{id: string, threadId: string}>} Directly labeled messages.
 */
function listInboxMessagesForRetentionLabel(labelId) {
  const messages = [];
  let pageToken = null;

  do {
    const options = {
      labelIds: [labelId, 'INBOX'],
      maxResults: RETENTION_CONFIG.ARCHIVE_LIST_PAGE_SIZE,
      includeSpamTrash: false,
      fields: 'messages(id,threadId),nextPageToken',
    };
    if (pageToken) {
      options.pageToken = pageToken;
    }

    const payload = Gmail.Users.Messages.list('me', options) || {};

    if (Array.isArray(payload.messages)) {
      payload.messages.forEach(message => {
        if (
          isConfigurationObject(message) &&
          typeof message.id === 'string' &&
          message.id &&
          typeof message.threadId === 'string' &&
          message.threadId
        ) {
          messages.push({ id: message.id, threadId: message.threadId });
        }
      });
    }
    pageToken = typeof payload.nextPageToken === 'string' &&
      payload.nextPageToken
      ? payload.nextPageToken
      : null;
  } while (pageToken);

  return messages;
}

/**
 * Removes the Inbox system label from directly retention-labeled messages.
 * Expired messages and generated system notifications are excluded by caller so
 * they can follow their existing Trash and notification paths unchanged.
 * Lookup or modification failures are reported but do not block retention.
 *
 * @param {Array} retentionPolicies Discovered valid retention-label policies.
 * @param {Set<string>} excludedMessageIds Messages that must not be archived.
 * @return {Object} Successful archive counts and nonfatal failure counts.
 */
function archiveRetentionLabeledInboxMessages(
  retentionPolicies,
  excludedMessageIds,
) {
  const result = createEmptyArchiveResult();
  const uniqueLabels = new Map();

  retentionPolicies.forEach(policy => {
    if (policy && policy.label) {
      uniqueLabels.set(policy.label.getId(), policy.labelName);
    }
  });
  if (uniqueLabels.size === 0) {
    return result;
  }

  if (
    typeof Gmail === 'undefined' ||
    !Gmail.Users ||
    !Gmail.Users.Messages
  ) {
    result.lookupFailureCount = uniqueLabels.size;
    const message =
      'Archive-on-label could not run because the advanced Gmail service is ' +
      'not enabled for this Apps Script project.';
    result.errors.push(message);
    console.error(message);
    return result;
  }

  const candidateMessages = new Map();
  for (const [labelId, labelName] of uniqueLabels.entries()) {
    try {
      const messages = listInboxMessagesForRetentionLabel(labelId);
      messages.forEach(message => {
        if (!excludedMessageIds.has(message.id)) {
          candidateMessages.set(message.id, message);
        }
      });
      verboseLog('ARCHIVE LABEL LOOKUP', {
        labelName,
        directlyLabeledInboxMessageCount: messages.length,
      });
    } catch (error) {
      result.lookupFailureCount += 1;
      const message =
        `Unable to evaluate Inbox messages for ${labelName}: ${error.message}`;
      result.errors.push(message);
      console.error(message);
    }
  }

  const candidates = [...candidateMessages.values()];
  const archivedThreadIds = new Set();
  for (
    let index = 0;
    index < candidates.length;
    index += RETENTION_CONFIG.ARCHIVE_BATCH_SIZE
  ) {
    const batch = candidates.slice(
      index,
      index + RETENTION_CONFIG.ARCHIVE_BATCH_SIZE,
    );

    try {
      Gmail.Users.Messages.batchModify(
        {
          ids: batch.map(message => message.id),
          removeLabelIds: ['INBOX'],
        },
        'me',
      );

      result.archivedMessageCount += batch.length;
      batch.forEach(message => archivedThreadIds.add(message.threadId));
      verboseLog('ARCHIVE BATCH', {
        batchSize: batch.length,
        messageIds: batch.map(message => message.id),
        threadIds: [...new Set(batch.map(message => message.threadId))],
      });
    } catch (error) {
      result.failedMessageCount += batch.length;
      const message =
        `Unable to archive ${batch.length} retention-labeled message(s): ` +
          error.message;
      result.errors.push(message);
      console.error(message);
    }
  }

  result.archivedConversationCount = archivedThreadIds.size;
  return result;
}

/**
 * Moves pending active messages to Trash in moderate batches. Messages are
 * moved individually because a conversation may contain both trashed and active
 * messages. Report records are added only after the corresponding move succeeds.
 *
 * @param {Array} pendingDeletions Threads, active messages, and report data.
 * @return {{deletedMessageRecords: Array, movedMessageCount: number,
 *   movedThreadCount: number}} Successful deletion details.
 */
function movePendingMessagesToTrash(pendingDeletions) {
  const pendingMessages = [];

  for (const item of pendingDeletions) {
    item.messagesToTrash.forEach((message, messageIndex) => {
      pendingMessages.push({
        message,
        messageRecord: item.isSystemNotification
          ? null
          : item.messageRecords[messageIndex],
        thread: item.thread,
        isSystemNotification: item.isSystemNotification,
      });
    });
  }

  verboseLog('TRASH', {
    pendingThreadCount: pendingDeletions.length,
    pendingMessageCount: pendingMessages.length,
    threadIds: pendingDeletions.map(item => item.thread.getId()),
  });
  const deletedMessageRecords = [];
  const movedThreadIds = new Set();
  const systemNotificationThreads = new Map();
  let movedMessageCount = 0;

  for (
    let index = 0;
    index < pendingMessages.length;
    index += RETENTION_CONFIG.TRASH_BATCH_SIZE
  ) {
    const batch = pendingMessages.slice(
      index,
      index + RETENTION_CONFIG.TRASH_BATCH_SIZE,
    );

    verboseLog('TRASH BATCH', {
      batchStartIndex: index,
      batchSize: batch.length,
      messageIds: batch.map(item => item.message.getId()),
      threadIds: [...new Set(batch.map(item => item.thread.getId()))],
    });

    for (const item of batch) {
      // Recheck immediately before the move in case the user manually trashed
      // the message after collection but before this batch was processed.
      if (item.message.isInTrash()) {
        verboseLog('TRASH MESSAGE SKIP', {
          messageId: item.message.getId(),
          threadId: item.thread.getId(),
          reason: 'Message is already in Trash',
        });
        continue;
      }

      item.message.moveToTrash();
      movedMessageCount += 1;
      movedThreadIds.add(item.thread.getId());

      if (item.isSystemNotification) {
        systemNotificationThreads.set(item.thread.getId(), item.thread);
      } else if (item.messageRecord) {
        deletedMessageRecords.push(item.messageRecord);
      }
    }

    verboseLog('TRASH BATCH', 'Individual message moves completed.');
  }

  for (const thread of systemNotificationThreads.values()) {
    // Internal notifications are deliberately silent and leave no temporary
    // operational labels behind after their active messages reach Trash.
    removeSystemNotificationLabels(thread);
  }

  return {
    deletedMessageRecords,
    movedMessageCount,
    movedThreadCount: movedThreadIds.size,
  };
}


/**
 * Removes the temporary system marker and every valid retention-period label
 * from a generated notification after it reaches Trash. Removing all retention
 * labels prevents the trashed summary from being rediscovered through
 * the configured notification-retention label on every run.
 *
 * @param {GmailThread} thread Generated notification thread.
 */
function removeSystemNotificationLabels(thread) {
  for (const label of thread.getLabels()) {
    const labelName = label.getName();

    if (
      labelNamesEqual(labelName, getSystemNotificationLabelName()) ||
      parseRetentionLabel(label) !== null
    ) {
      label.removeFromThread(thread);
    }
  }
}

/**
 * Deletes the temporary internal system label when it is no longer attached to
 * any active notification. The label is recreated automatically the next time
 * a system email is sent.
 */
function deleteSystemNotificationLabelIfUnused() {
  const systemLabel = GmailApp.getUserLabelByName(
    getSystemNotificationLabelName(),
  );

  if (!systemLabel) {
    return;
  }

  if (systemLabel.getThreads(0, 1).length === 0) {
    systemLabel.deleteLabel();
    console.log(
      `Deleted unused internal label: ${getSystemNotificationLabelName()}`,
    );
  }
}

/**
 * Resolves the recipient and labels shared by every generated system email.
 * Keeping delivery metadata in one place guarantees that deletion summaries
 * and update-only notifications follow the same retention lifecycle.
 *
 * @return {Object} Recipient and managed Gmail labels.
 */
function getSystemNotificationDeliveryContext() {
  return {
    recipient: getNotificationRecipient(),
    systemLabel: getOrCreateLabel(getSystemNotificationLabelName()),
    notificationRetentionLabel: getOrCreateLabel(
      getNotificationRetentionLabelName(),
    ),
  };
}

/**
 * Sends, labels, surfaces, and marks one managed system email unread.
 *
 * @param {Object} context Shared delivery context.
 * @param {string} subject Email subject.
 * @param {string} plainBody Plain-text fallback.
 * @param {string} htmlBody HTML email body.
 * @return {GmailMessage} Sent Gmail message.
 */
function sendManagedSystemEmail(context, subject, plainBody, htmlBody) {
  const sentMessage = GmailApp.createDraft(
    context.recipient,
    subject,
    plainBody,
    {
      htmlBody,
      name: 'Gmail Retention Manager',
    },
  ).send();
  const notificationThread = sentMessage.getThread();

  context.systemLabel.addToThread(notificationThread);
  context.notificationRetentionLabel.addToThread(notificationThread);
  notificationThread.moveToInbox();
  notificationThread.markUnread();

  verboseLog('SYSTEM EMAIL SENT', {
    subject,
    messageId: sentMessage.getId(),
    threadId: notificationThread.getId(),
    systemLabel: context.systemLabel.getName(),
    retentionLabel: context.notificationRetentionLabel.getName(),
  });
  return sentMessage;
}

/**
 * Sends one or more deletion summaries. Every deleted ordinary Gmail message is
 * represented in exactly one table row. Large runs are split to avoid oversized
 * email bodies while still reporting the entire deletion set.
 *
 * @param {Array} records Deleted message records.
 * @param {Date} runDate Date the retention run occurred.
 * @param {Object|null} availableUpdate Newer GitHub release metadata.
 * @return {number} Number of summary emails sent.
 */
function sendDeletionSummaries(records, runDate, availableUpdate) {
  verboseLog('NOTIFICATION', {
    recordCount: records.length,
    runDate: runDate.toISOString(),
  });
  const deliveryContext = getSystemNotificationDeliveryContext();
  const timeZone = getConfiguredRetentionTimeZone();
  const adminPageUrl = getAdminPageUrl();
  verboseLog('NOTIFICATION LABELS', {
    recipient: deliveryContext.recipient,
    systemLabel: describeLabel(deliveryContext.systemLabel),
    notificationRetentionLabel: describeLabel(
      deliveryContext.notificationRetentionLabel,
    ),
    timeZone,
    adminPageUrl,
    availableUpdate,
  });

  // Present newest deleted messages first.
  records.sort(
    (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
  );

  const chunks = chunkArray(
    records,
    RETENTION_CONFIG.MAX_ROWS_PER_NOTIFICATION,
  );

  chunks.forEach((chunk, index) => {
    const partNumber = index + 1;
    const totalParts = chunks.length;
    const formattedRunDate = Utilities.formatDate(
      runDate,
      timeZone,
      'yyyy-MM-dd h:mm a',
    );
    const subject = buildNotificationSubject(
      records.length,
      partNumber,
      totalParts,
    );

    const plainBody = buildPlainTextSummary(
      chunk,
      records.length,
      partNumber,
      totalParts,
      formattedRunDate,
      timeZone,
      availableUpdate,
      adminPageUrl,
    );
    const htmlBody = buildHtmlSummary(
      chunk,
      records.length,
      partNumber,
      totalParts,
      formattedRunDate,
      timeZone,
      availableUpdate,
      adminPageUrl,
    );

    /*
     * GmailDraft.send() returns the sent GmailMessage, allowing the script to
     * label, place, and mark the generated notification without searching for it.
     */
    verboseLog('NOTIFICATION SEND', {
      partNumber,
      totalParts,
      subject,
      rowCount: chunk.length,
    });

    const sentMessage = sendManagedSystemEmail(
      deliveryContext,
      subject,
      plainBody,
      htmlBody,
    );
    verboseLog('NOTIFICATION SENT', {
      messageId: sentMessage.getId(),
      threadId: sentMessage.getThread().getId(),
    });
  });

  return chunks.length;
}

/**
 * Sends one release-specific notification when that newer version has not
 * already received its dedicated update-only email. Summary notices do not
 * suppress this one-time notification.
 *
 * @param {Object|null} availableUpdate Newer GitHub release metadata.
 * @param {Date} runDate Date the update was detected.
 * @return {number} One when sent, otherwise zero.
 */
function sendUpdateOnlyNotificationIfNeeded(availableUpdate, runDate) {
  if (!availableUpdate || hasSentUpdateOnlyNotification(availableUpdate)) {
    verboseLog(
      'UPDATE-ONLY NOTIFICATION',
      availableUpdate
        ? `Version ${availableUpdate.version} was already announced.`
        : 'No newer release is available.',
    );
    return 0;
  }

  const deliveryContext = getSystemNotificationDeliveryContext();
  const timeZone = getConfiguredRetentionTimeZone();
  const adminPageUrl = getAdminPageUrl();
  const formattedRunDate = Utilities.formatDate(
    runDate,
    timeZone,
    'yyyy-MM-dd h:mm a',
  );
  const subject = buildUpdateNotificationSubject(availableUpdate);
  const plainBody = buildPlainTextUpdateNotification(
    availableUpdate,
    formattedRunDate,
    adminPageUrl,
  );
  const htmlBody = buildHtmlUpdateNotification(
    availableUpdate,
    formattedRunDate,
    adminPageUrl,
  );

  sendManagedSystemEmail(deliveryContext, subject, plainBody, htmlBody);
  recordUpdateOnlyNotification(availableUpdate);
  return 1;
}

/**
 * Resolves the notification recipient. The summary is intentionally sent to the
 * same Gmail account that owns the installable trigger because that is the account
 * whose labels and threads this script can manage.
 *
 * @return {string} Email address receiving deletion summaries.
 */
function getNotificationRecipient() {
  const effectiveUserEmail = Session.getEffectiveUser().getEmail();

  if (!effectiveUserEmail) {
    throw new Error(
      "Unable to determine the trigger owner's email address. Run the script " +
      'manually once, authorize it, and use an installable time-driven trigger.',
    );
  }

  return effectiveUserEmail;
}

/**
 * Removes the configured root path from a retention label shown to the user.
 *
 * @param {string} labelName Full managed Gmail label path.
 * @return {string} Child retention expression, or the original normalized name.
 */
function getRetentionLabelDisplayName(labelName) {
  const normalizedLabel = normalizeRetentionLabelName(labelName);
  const normalizedRoot = normalizeRetentionLabelName(getRootLabelName());
  const rootPrefix = `${normalizedRoot}/`;

  return normalizedLabel.toLowerCase().startsWith(rootPrefix.toLowerCase())
    ? normalizedLabel.slice(rootPrefix.length)
    : normalizedLabel;
}

/** @return {string} HTML banner for a newer published release. */
function buildHtmlAvailableUpdateNotice(availableUpdate) {
  if (!availableUpdate) {
    return '';
  }

  return `
    <div style="margin:16px 0;padding:14px;border:1px solid #8ab4f8;border-radius:8px;background:#e8f0fe;color:#174ea6;">
      <strong>Gmail Retention Manager update available</strong><br>
      Installed version: v${escapeHtml(RETENTION_CONFIG.VERSION)}<br>
      Available version: v${escapeHtml(availableUpdate.version)}<br>
      <a href="${escapeHtml(availableUpdate.releaseUrl)}" style="font-weight:700;">
        View the latest GitHub release and update manually
      </a>
    </div>`;
}

/** @return {string} Permanent HTML link to the private admin page. */
function buildHtmlAdminPageLink(adminPageUrl) {
  if (!adminPageUrl) {
    return `
      <p style="margin:16px 0 0;color:#5f6368;font-size:12px;">
        The admin-page link is unavailable until this Apps Script project is
        deployed as a web app.
      </p>`;
  }

  return `
    <p style="margin:16px 0 0;">
      <a href="${escapeHtml(adminPageUrl)}" style="font-weight:700;">
        Manage Gmail Retention Manager settings
      </a>
    </p>`;
}

/** @return {string} HTML warning when verbose logging remains enabled. */
function buildHtmlVerboseLoggingWarning() {
  if (!getRetentionSettings().VERBOSE_LOGGING) {
    return '';
  }

  return `
    <div style="margin:16px 0 0;padding:12px;border:1px solid #f9ab00;border-radius:6px;background:#fef7e0;color:#7a4f01;">
      <strong>Verbose logging is enabled.</strong>
      Execution logs may contain message subjects, label names, thread IDs,
      and other mailbox metadata. Use verbose logging only while troubleshooting
      and turn it off afterward.
    </div>`;
}

/** @return {Array<string>} Plain-text warning lines for verbose logging. */
function getPlainTextVerboseLoggingWarningLines() {
  return getRetentionSettings().VERBOSE_LOGGING
    ? [
        '',
        'WARNING: Verbose logging is enabled. Execution logs may contain ' +
          'message subjects, label names, thread IDs, and other mailbox ' +
          'metadata. Use it only while troubleshooting and turn it off afterward.',
      ]
    : [];
}

/**
 * Builds the HTML summary table.
 *
 * @param {Array} records Rows included in this notification part.
 * @param {number} totalRecordCount Total rows across all parts.
 * @param {number} partNumber Current part number.
 * @param {number} totalParts Total notification parts.
 * @param {string} formattedRunDate Formatted execution date.
 * @param {string} timeZone Apps Script project time zone.
 * @param {Object|null} availableUpdate Newer GitHub release metadata, if any.
 * @param {string} adminPageUrl Deployed private admin-page URL.
 * @return {string} HTML email body.
 */
function buildHtmlSummary(
  records,
  totalRecordCount,
  partNumber,
  totalParts,
  formattedRunDate,
  timeZone,
  availableUpdate,
  adminPageUrl,
) {
  const rows = records.map((record, index) => {
    const received = Utilities.formatDate(
      record.receivedAt,
      timeZone,
      'yyyy-MM-dd h:mm a',
    );
    const rowBackground = index % 2 === 0 ? '#ffffff' : '#f8f9fa';

    return `
      <tr style="background:${rowBackground};">
        <td style="padding:8px;border:1px solid #d9d9d9;vertical-align:top;">
          <a href="${escapeHtml(record.trashPermalink)}">
            ${escapeHtml(record.subject)}
          </a>
        </td>
        <td style="padding:8px;border:1px solid #d9d9d9;vertical-align:top;">
          ${escapeHtml(record.sender)}
        </td>
        <td style="padding:8px;border:1px solid #d9d9d9;white-space:nowrap;vertical-align:top;">
          ${escapeHtml(received)}
        </td>
        <td style="padding:8px;border:1px solid #d9d9d9;white-space:nowrap;vertical-align:top;">
          ${escapeHtml(getRetentionLabelDisplayName(record.retentionLabel))}
        </td>
      </tr>`;
  }).join('');

  const partText = totalParts > 1
    ? ` This is part ${partNumber} of ${totalParts}.`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#202124;">
      <h2 style="margin:0 0 12px;">Gmail Retention Summary</h2>
      <p style="margin:0 0 12px;">
        The retention run completed at ${escapeHtml(formattedRunDate)} and moved
        ${totalRecordCount} message(s) to Trash.${escapeHtml(partText)}
      </p>
      <p style="margin:0 0 16px;">
        Click a subject to open its Gmail conversation. To restore a message,
        remove its retention label and move the conversation back to Inbox in Gmail.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr style="background:#f1f3f4;text-align:left;">
            <th style="padding:8px;border:1px solid #d9d9d9;">Subject</th>
            <th style="padding:8px;border:1px solid #d9d9d9;">Sender</th>
            <th style="padding:8px;border:1px solid #d9d9d9;">Received</th>
            <th style="padding:8px;border:1px solid #d9d9d9;">Retention</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:16px 0 0;color:#5f6368;font-size:12px;">
        This notification is automatically labeled
        ${escapeHtml(getNotificationRetentionLabelName())} and will be
        moved to Trash silently when its retention period expires.
      </p>
      ${buildHtmlAvailableUpdateNotice(availableUpdate)}
      ${buildHtmlVerboseLoggingWarning()}
      ${buildHtmlAdminPageLink(adminPageUrl)}
      <p style="margin:8px 0 0;color:#5f6368;font-size:12px;">
        Generated by
        <a href="${escapeHtml(RETENTION_CONFIG.PROJECT_REPOSITORY_URL)}">Gmail Retention Manager</a>
        &middot;
        <a href="${escapeHtml(getProjectReleaseUrl())}">v${escapeHtml(RETENTION_CONFIG.VERSION)}</a>
      </p>
    </div>`;
}

/**
 * Builds a plain-text fallback for email clients that do not render HTML.
 *
 * @param {Array} records Rows included in this notification part.
 * @param {number} totalRecordCount Total rows across all parts.
 * @param {number} partNumber Current part number.
 * @param {number} totalParts Total notification parts.
 * @param {string} formattedRunDate Formatted execution date.
 * @param {string} timeZone Configured notification time zone.
 * @param {Object|null} availableUpdate Newer GitHub release metadata, if any.
 * @param {string} adminPageUrl Deployed private admin-page URL.
 * @return {string} Plain-text email body.
 */
function buildPlainTextSummary(
  records,
  totalRecordCount,
  partNumber,
  totalParts,
  formattedRunDate,
  timeZone,
  availableUpdate,
  adminPageUrl,
) {
  const partText = totalParts > 1
    ? ` Part ${partNumber} of ${totalParts}.`
    : '';

  const lines = [
    'Gmail Retention Summary',
    '',
    `Run completed: ${formattedRunDate}`,
    `Messages moved to Trash: ${totalRecordCount}.${partText}`,
    '',
    'To restore a message, remove its retention label and move the ' +
      'conversation back to Inbox in Gmail.',
    '',
  ];

  for (const record of records) {
    lines.push(`Subject: ${record.subject}`);
    lines.push(`Sender: ${record.sender}`);
    lines.push(
      `Received: ${Utilities.formatDate(
        record.receivedAt,
        timeZone,
        'yyyy-MM-dd h:mm a',
      )}`,
    );
    lines.push(
      `Retention: ${getRetentionLabelDisplayName(record.retentionLabel)}`,
    );
    lines.push(`Open in Trash: ${record.trashPermalink}`);
    lines.push('');
  }

  lines.push(
    `This notification has ${getNotificationRetentionLabelName()} ` +
    'and will be moved to Trash silently when its retention period expires.',
  );
  if (availableUpdate) {
    lines.push('');
    lines.push(
      `UPDATE AVAILABLE: Installed v${RETENTION_CONFIG.VERSION}; ` +
        `available v${availableUpdate.version}.`,
    );
    lines.push(`Latest GitHub release: ${availableUpdate.releaseUrl}`);
  }
  lines.push(...getPlainTextVerboseLoggingWarningLines());
  lines.push('');
  if (adminPageUrl) {
    lines.push(`Manage Gmail Retention Manager settings: ${adminPageUrl}`);
  } else {
    lines.push(
      'Admin page: unavailable until this Apps Script project is deployed as ' +
        'a web app.',
    );
  }
  lines.push(
    `Generated by Gmail Retention Manager v${RETENTION_CONFIG.VERSION}: ` +
    getProjectReleaseUrl(),
  );
  lines.push(`Repository: ${RETENTION_CONFIG.PROJECT_REPOSITORY_URL}`);

  return lines.join('\n');
}

/**
 * Builds the HTML body for a release-specific update-only notification.
 *
 * @param {Object} availableUpdate Newer GitHub release metadata.
 * @param {string} formattedRunDate Formatted detection time.
 * @param {string} adminPageUrl Deployed private admin-page URL.
 * @return {string} HTML email body.
 */
function buildHtmlUpdateNotification(
  availableUpdate,
  formattedRunDate,
  adminPageUrl,
) {
  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#202124;">
      <h2 style="margin:0 0 12px;">Gmail Retention Manager Update Available</h2>
      <p style="margin:0 0 12px;">
        Version ${escapeHtml(availableUpdate.version)} is now available. This
        installation is currently running version
        ${escapeHtml(RETENTION_CONFIG.VERSION)}.
      </p>
      <p style="margin:0 0 16px;color:#5f6368;">
        The update was detected at ${escapeHtml(formattedRunDate)}. Review the
        release on GitHub and install it manually when convenient.
      </p>
      <p style="margin:0 0 18px;">
        <a
          href="${escapeHtml(availableUpdate.releaseUrl)}"
          style="display:inline-block;padding:10px 14px;border-radius:6px;background:#1a73e8;color:#ffffff;font-weight:700;text-decoration:none;"
        >
          View v${escapeHtml(availableUpdate.version)} on GitHub
        </a>
      </p>
      <p style="margin:0;color:#5f6368;font-size:12px;">
        This update-only notice is sent once for each newer release. Deletion
        summaries will continue displaying the update until it is installed.
      </p>
      <p style="margin:8px 0 0;color:#5f6368;font-size:12px;">
        This notification is automatically labeled
        ${escapeHtml(getNotificationRetentionLabelName())} and will be moved to
        Trash silently when its retention period expires.
      </p>
      ${buildHtmlVerboseLoggingWarning()}
      ${buildHtmlAdminPageLink(adminPageUrl)}
      <p style="margin:8px 0 0;color:#5f6368;font-size:12px;">
        Generated by
        <a href="${escapeHtml(RETENTION_CONFIG.PROJECT_REPOSITORY_URL)}">Gmail Retention Manager</a>
        &middot;
        <a href="${escapeHtml(getProjectReleaseUrl())}">v${escapeHtml(RETENTION_CONFIG.VERSION)}</a>
      </p>
    </div>`;
}

/**
 * Builds the plain-text body for a release-specific update-only notification.
 *
 * @param {Object} availableUpdate Newer GitHub release metadata.
 * @param {string} formattedRunDate Formatted detection time.
 * @param {string} adminPageUrl Deployed private admin-page URL.
 * @return {string} Plain-text email body.
 */
function buildPlainTextUpdateNotification(
  availableUpdate,
  formattedRunDate,
  adminPageUrl,
) {
  const lines = [
    'Gmail Retention Manager Update Available',
    '',
    `Installed version: v${RETENTION_CONFIG.VERSION}`,
    `Available version: v${availableUpdate.version}`,
    `Detected: ${formattedRunDate}`,
    '',
    'View the latest GitHub release and update manually: ' +
      availableUpdate.releaseUrl,
    '',
    'This update-only notice is sent once for each newer release. Deletion ' +
      'summaries will continue displaying the update until it is installed.',
    '',
    `This notification has ${getNotificationRetentionLabelName()} and will be ` +
      'moved to Trash silently when its retention period expires.',
    ...getPlainTextVerboseLoggingWarningLines(),
    '',
  ];

  if (adminPageUrl) {
    lines.push(`Manage Gmail Retention Manager settings: ${adminPageUrl}`);
  } else {
    lines.push(
      'Admin page: unavailable until this Apps Script project is deployed as ' +
        'a web app.',
    );
  }
  lines.push(
    `Current release: ${getProjectReleaseUrl()}`,
    `Repository: ${RETENTION_CONFIG.PROJECT_REPOSITORY_URL}`,
  );
  return lines.join('\n');
}

/**
 * Returns an existing Gmail label or creates it when absent.
 *
 * @param {string} labelName Full Gmail label name.
 * @return {GmailLabel} Existing or newly created label.
 */
function getOrCreateLabel(labelName) {
  const canonicalName = normalizeRetentionLabelName(labelName);
  const pathSegments = canonicalName.split('/');
  let currentPath = '';
  let deepestLabel = null;

  verboseLog('GET OR CREATE LABEL', {
    requestedName: labelName,
    canonicalName,
    pathSegments,
  });

  /*
   * Create each level in order. For a path such as Root/7d, this verifies or
   * creates Root first and then Root/7d. This also supports deeper paths without
   * changing the implementation.
   */
  for (const segment of pathSegments) {
    if (!segment) {
      throw new Error(`Invalid Gmail label path: ${labelName}`);
    }

    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    verboseLog('GET OR CREATE LABEL SEGMENT', { segment, currentPath });

    deepestLabel = findUserLabelByName(currentPath);

    if (deepestLabel) {
      verboseLog('GET OR CREATE LABEL FOUND', describeLabel(deepestLabel));
      continue;
    }

    verboseLog('GET OR CREATE LABEL CREATE ATTEMPT', currentPath);
    try {
      deepestLabel = GmailApp.createLabel(currentPath);
    } catch (error) {
      console.error(
        `GmailApp.createLabel(${JSON.stringify(currentPath)}) failed: ` +
          `${error && error.stack ? error.stack : error}`,
      );
      throw error;
    }

    verboseLog('GET OR CREATE LABEL CREATE RETURN', describeLabel(deepestLabel));

    /*
     * Gmail normally exposes a newly created label immediately. Retry the lookup
     * briefly so verbose diagnostics can distinguish an eventual-consistency
     * delay from a true creation failure.
     */
    let verifiedLabel = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      verifiedLabel = findUserLabelByName(currentPath);
      verboseLog('GET OR CREATE LABEL VERIFY', {
        currentPath,
        attempt,
        result: describeLabel(verifiedLabel),
      });

      if (verifiedLabel) {
        break;
      }

      Utilities.sleep(250);
    }

    if (!verifiedLabel) {
      throw new Error(
        `GmailApp.createLabel() returned a label for ${currentPath}, but ` +
          'the label could not be found during verification.',
      );
    }

    deepestLabel = verifiedLabel;
  }

  verboseLog('GET OR CREATE LABEL COMPLETE', describeLabel(deepestLabel));
  return deepestLabel;
}

/**
 * Finds a user label by full name. Gmail's direct lookup is attempted first,
 * followed by a case-insensitive scan so a differently capitalized Retention
 * root is not duplicated.
 *
 * @param {string} labelName Full label path.
 * @return {GmailLabel|null} Matching label, or null when absent.
 */
function findUserLabelByName(labelName) {
  const normalizedTarget = normalizeRetentionLabelName(labelName).toLowerCase();
  verboseLog('FIND LABEL', { labelName, normalizedTarget });

  const directMatch = GmailApp.getUserLabelByName(labelName);
  verboseLog('FIND LABEL DIRECT RESULT', describeLabel(directMatch));

  if (directMatch) {
    return directMatch;
  }

  const userLabels = GmailApp.getUserLabels();
  const scannedMatch = userLabels.find(label =>
    normalizeRetentionLabelName(label.getName()).toLowerCase() ===
      normalizedTarget,
  ) || null;

  verboseLog('FIND LABEL SCAN RESULT', {
    searchedName: labelName,
    scannedLabelCount: userLabels.length,
    result: describeLabel(scannedMatch),
  });

  return scannedMatch;
}

/**
 * Splits an array into fixed-size chunks.
 *
 * @param {Array} items Source items.
 * @param {number} size Maximum items per chunk.
 * @return {Array[]} Chunked arrays.
 */
function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * Writes a verbose diagnostic log entry when VERBOSE_LOGGING is enabled.
 * Objects are serialized safely so Apps Script's execution log shows their
 * complete values instead of only "[object Object]".
 *
 * @param {string} step Short diagnostic step name.
 * @param {*} details Message or structured diagnostic details.
 */
function verboseLog(step, details) {
  if (!getRetentionSettings().VERBOSE_LOGGING) {
    return;
  }

  let renderedDetails;
  if (typeof details === 'string') {
    renderedDetails = details;
  } else {
    try {
      renderedDetails = JSON.stringify(details, null, 2);
    } catch (error) {
      renderedDetails = String(details);
    }
  }

  console.log(`[VERBOSE][${step}] ${renderedDetails}`);
}

/**
 * Logs a complete snapshot of all user-created Gmail labels. This is especially
 * useful for diagnosing nested-label display differences, alternate slash
 * characters, capitalization, and unexpected whitespace.
 *
 * @param {string} step Snapshot label used in the execution log.
 */
function verboseLabelSnapshot(step) {
  if (!getRetentionSettings().VERBOSE_LOGGING) {
    return;
  }

  let labels;
  try {
    labels = GmailApp.getUserLabels();
  } catch (error) {
    console.error(
      `[VERBOSE][${step}] GmailApp.getUserLabels() failed: ` +
        `${error && error.stack ? error.stack : error}`,
    );
    throw error;
  }

  verboseLog(step, {
    count: labels.length,
    labels: labels.map(label => ({
      id: safeGetLabelId(label),
      rawName: label.getName(),
      normalizedName: normalizeRetentionLabelName(label.getName()),
      recognizedRetentionPolicy: Boolean(parseRetentionLabel(label)),
    })),
  });
}

/**
 * Produces log-safe metadata for a GmailLabel without throwing when the input is
 * null or when a mock/test label does not implement getId().
 *
 * @param {GmailLabel|null|undefined} label Label to describe.
 * @return {Object|null} Serializable label metadata.
 */
function describeLabel(label) {
  if (!label) {
    return null;
  }

  let name;
  try {
    name = label.getName();
  } catch (error) {
    name = '(unable to read label name)';
  }

  return {
    id: safeGetLabelId(label),
    rawName: name,
    normalizedName: normalizeRetentionLabelName(name),
  };
}

/**
 * Safely reads a Gmail label ID for diagnostics.
 *
 * @param {GmailLabel} label Gmail label.
 * @return {string|null} Label ID when available.
 */
function safeGetLabelId(label) {
  if (!label || typeof label.getId !== 'function') {
    return null;
  }

  try {
    return label.getId();
  } catch (error) {
    return null;
  }
}

/**
 * Escapes text inserted into HTML element content.
 *
 * @param {*} value Value to escape.
 * @return {string} HTML-safe text.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
