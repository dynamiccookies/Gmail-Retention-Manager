/**
 * Gmail Label-Based Retention Manager
 * ====================================
 *
 * Repository: https://github.com/dynamiccookies/gmail-retention-manager
 *
 * Version: 0.5.0
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
 * 9. When a deletion summary is generated and CHECK_FOR_UPDATES is enabled, the
 *    script checks the repository's latest published GitHub release. If that
 *    release has a newer semantic version, the notification footer displays a
 *    direct release link. Results are cached for up to six hours, and lookup
 *    failures never interrupt retention processing or notification delivery.
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
 * Set RETENTION_CONFIG.VERBOSE_LOGGING to true, save the project, and run
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

const RETENTION_CONFIG = Object.freeze({
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

  // Child-label values created only when ROOT_LABEL does not exist at all.
  DEFAULT_RETENTION_LABEL_SUFFIXES: Object.freeze(['7d', '1m']),

  // Notification subject format: "[Gmail Retention] 3 messages deleted".
  NOTIFICATION_SUBJECT_PREFIX: '[Gmail Retention]',

  // Child-label value applied to summary emails before silent Trash cleanup.
  // Any supported retention expression can be used, such as '12h' or '7 days'.
  NOTIFICATION_RETENTION_LABEL_SUFFIX: '1d',

  // Temporary child label used only for summary emails generated by this script.
  SYSTEM_NOTIFICATION_LABEL_SUFFIX: '_System',

  // Check the latest published GitHub release when sending a deletion summary.
  CHECK_FOR_UPDATES: true,

  // Displayed in notification footers and linked to the matching GitHub release.
  VERSION: '0.5.0',
  PROJECT_REPOSITORY_URL:
    'https://github.com/dynamiccookies/gmail-retention-manager',

  // Cache GitHub release results to reduce external requests. Apps Script allows
  // a maximum cache duration of 21,600 seconds (six hours).
  UPDATE_CHECK_CACHE_SECONDS: 21600,

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

/**
 * Returns the normalized configured root label and rejects an empty value.
 * The root may itself be nested, such as "Automation/Retention".
 *
 * @return {string} Normalized root-label path.
 */
function getRootLabelName() {
  const rootLabel = normalizeRetentionLabelName(RETENTION_CONFIG.ROOT_LABEL)
    .replace(/^\/+|\/+$/g, '');

  if (!rootLabel) {
    throw new Error('RETENTION_CONFIG.ROOT_LABEL cannot be empty.');
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
  return RETENTION_CONFIG.DEFAULT_RETENTION_LABEL_SUFFIXES.map(
    suffix => buildManagedLabelName(suffix),
  );
}

/** @return {string} Full retention label applied to summary notifications. */
function getNotificationRetentionLabelName() {
  return buildManagedLabelName(
    RETENTION_CONFIG.NOTIFICATION_RETENTION_LABEL_SUFFIX,
  );
}

/** @return {string} Full temporary system-notification label path. */
function getSystemNotificationLabelName() {
  return buildManagedLabelName(RETENTION_CONFIG.SYSTEM_NOTIFICATION_LABEL_SUFFIX);
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
  return 'gmail-retention-update:' +
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
  if (!RETENTION_CONFIG.CHECK_FOR_UPDATES) {
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
      cache.put(
        cacheKey,
        JSON.stringify({ release: null, responseCode }),
        RETENTION_CONFIG.UPDATE_CHECK_CACHE_SECONDS,
      );
      return null;
    }

    const payload = JSON.parse(responseText);
    const parsedVersion = parseSemanticVersion(payload.tag_name);

    if (!parsedVersion || !payload.html_url) {
      verboseLog('UPDATE CHECK INVALID RELEASE', {
        tagName: payload.tag_name,
        releaseUrl: payload.html_url,
      });
      cache.put(
        cacheKey,
        JSON.stringify({ release: null, responseCode }),
        RETENTION_CONFIG.UPDATE_CHECK_CACHE_SECONDS,
      );
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
    verboseLog(
      'UPDATE CHECK FAILURE',
      error && error.stack ? error.stack : String(error),
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
 */
function enforceGmailRetention() {
  verboseLog('MAIN', 'enforceGmailRetention() entered.');
  const lock = LockService.getScriptLock();
  verboseLog('LOCK', `Attempting script lock for ${RETENTION_CONFIG.LOCK_TIMEOUT_MS} ms.`);

  if (!lock.tryLock(RETENTION_CONFIG.LOCK_TIMEOUT_MS)) {
    console.log('Another retention run is already active. This run was skipped.');
    return;
  }

  try {
    verboseLog('LOCK', 'Script lock acquired.');
    const now = new Date();
    const effectiveUserEmail = Session.getEffectiveUser().getEmail();
    const activeUserEmail = Session.getActiveUser().getEmail();

    verboseLog('SESSION', {
      effectiveUserEmail,
      activeUserEmail,
      scriptTimeZone: Session.getScriptTimeZone(),
      now: now.toISOString(),
      config: {
        rootLabel: RETENTION_CONFIG.ROOT_LABEL,
        defaultRetentionLabels: getDefaultRetentionLabelNames(),
        notificationRetentionLabel:
          getNotificationRetentionLabelName(),
        systemNotificationLabel:
          getSystemNotificationLabelName(),
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
      console.log('No valid retention labels were found. Nothing to process.');
      return;
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
    }

    const deletionResult = movePendingMessagesToTrash(pendingDeletions);
    const deletedMessageRecords = deletionResult.deletedMessageRecords;

    // Delete the temporary internal label when no active notification uses it.
    deleteSystemNotificationLabelIfUnused();

    /*
     * Only ordinary deleted messages generate a notification. When the only
     * deletion is an expired system notification, no new notification is sent.
     */
    if (deletedMessageRecords.length > 0) {
      sendDeletionSummaries(deletedMessageRecords, now);
    }

    console.log(
      [
        `Reviewed ${threadMap.size} conversation(s).`,
        `Moved ${deletionResult.movedMessageCount} active message(s) to Trash ` +
          `from ${deletionResult.movedThreadCount} conversation(s).`,
        `Reported ${deletedMessageRecords.length} deleted message(s).`,
        `Removed ${removedRetentionLabelCount} redundant retention label(s).`,
      ].join(' '),
    );
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
 * accidental filter matches cannot change the configured summary lifecycle.
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

  return `${RETENTION_CONFIG.NOTIFICATION_SUBJECT_PREFIX} ` +
    `${formatMessageCount(totalMessageCount)} deleted${partSuffix}`;
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
 * a deletion summary is sent.
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
 * Sends one or more deletion summaries. Every deleted ordinary Gmail message is
 * represented in exactly one table row. Large runs are split to avoid oversized
 * email bodies while still reporting the entire deletion set.
 *
 * @param {Array} records Deleted message records.
 * @param {Date} runDate Date the retention run occurred.
 */
function sendDeletionSummaries(records, runDate) {
  verboseLog('NOTIFICATION', {
    recordCount: records.length,
    runDate: runDate.toISOString(),
  });
  const recipient = getNotificationRecipient();
  const systemLabel = getOrCreateLabel(
    getSystemNotificationLabelName(),
  );
  const notificationRetentionLabel = getOrCreateLabel(
    getNotificationRetentionLabelName(),
  );
  const timeZone = Session.getScriptTimeZone();
  const availableUpdate = getAvailableUpdate();
  verboseLog('NOTIFICATION LABELS', {
    recipient,
    systemLabel: describeLabel(systemLabel),
    notificationRetentionLabel: describeLabel(notificationRetentionLabel),
    timeZone,
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
      'yyyy-MM-dd HH:mm:ss z',
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
      availableUpdate,
    );
    const htmlBody = buildHtmlSummary(
      chunk,
      records.length,
      partNumber,
      totalParts,
      formattedRunDate,
      timeZone,
      availableUpdate,
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

    const sentMessage = GmailApp.createDraft(
      recipient,
      subject,
      plainBody,
      {
        htmlBody,
        name: 'Gmail Retention Manager',
      },
    ).send();

    const notificationThread = sentMessage.getThread();
    verboseLog('NOTIFICATION SENT', {
      messageId: sentMessage.getId(),
      threadId: notificationThread.getId(),
    });

    // The internal marker prevents this message from appearing in later reports.
    systemLabel.addToThread(notificationThread);
    notificationRetentionLabel.addToThread(notificationThread);

    // Make the summary visible as a normal unread inbox notification.
    notificationThread.moveToInbox();
    notificationThread.markUnread();
  });
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
 * Builds the HTML summary table.
 *
 * @param {Array} records Rows included in this notification part.
 * @param {number} totalRecordCount Total rows across all parts.
 * @param {number} partNumber Current part number.
 * @param {number} totalParts Total notification parts.
 * @param {string} formattedRunDate Formatted execution date.
 * @param {string} timeZone Apps Script project time zone.
 * @param {Object|null} availableUpdate Newer GitHub release metadata, if any.
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
) {
  const rows = records.map(record => {
    const received = Utilities.formatDate(
      record.receivedAt,
      timeZone,
      'yyyy-MM-dd HH:mm:ss z',
    );

    return `
      <tr>
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
          ${escapeHtml(record.retentionLabel)}
        </td>
      </tr>`;
  }).join('');

  const partText = totalParts > 1
    ? ` This is part ${partNumber} of ${totalParts}.`
    : '';
  const updateNotice = availableUpdate
    ? `
        &middot;
        <strong>
          <a href="${escapeHtml(availableUpdate.releaseUrl)}">
            New version available: v${escapeHtml(availableUpdate.version)}
          </a>
        </strong>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#202124;">
      <h2 style="margin:0 0 12px;">Gmail retention summary</h2>
      <p style="margin:0 0 12px;">
        The retention run completed at ${escapeHtml(formattedRunDate)} and moved
        ${totalRecordCount} message(s) to Trash.${escapeHtml(partText)}
      </p>
      <p style="margin:0 0 16px;">
        Click a subject to open its Gmail conversation. Removing the retention
        label and moving the conversation back to Inbox must be done in Gmail.
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
      <p style="margin:8px 0 0;color:#5f6368;font-size:12px;">
        Generated by
        <a href="${escapeHtml(RETENTION_CONFIG.PROJECT_REPOSITORY_URL)}">Gmail Retention Manager</a>
        &middot;
        <a href="${escapeHtml(getProjectReleaseUrl())}">v${escapeHtml(RETENTION_CONFIG.VERSION)}</a>
        ${updateNotice}
      </p>
    </div>`;
}

/**
 * Builds a plain-text fallback for email clients that do not render HTML.
 *
 * @return {string} Plain-text email body.
 */
function buildPlainTextSummary(
  records,
  totalRecordCount,
  partNumber,
  totalParts,
  formattedRunDate,
  availableUpdate,
) {
  const partText = totalParts > 1
    ? ` Part ${partNumber} of ${totalParts}.`
    : '';

  const lines = [
    'Gmail retention summary',
    '',
    `Run completed: ${formattedRunDate}`,
    `Messages moved to Trash: ${totalRecordCount}.${partText}`,
    '',
  ];

  for (const record of records) {
    lines.push(`Subject: ${record.subject}`);
    lines.push(`Sender: ${record.sender}`);
    lines.push(`Received: ${record.receivedAt.toISOString()}`);
    lines.push(`Retention: ${record.retentionLabel}`);
    lines.push(`Open in Trash: ${record.trashPermalink}`);
    lines.push('');
  }

  lines.push(
    `This notification has ${getNotificationRetentionLabelName()} ` +
    'and will be moved to Trash silently when its retention period expires.',
  );
  lines.push('');
  lines.push(
    `Generated by Gmail Retention Manager v${RETENTION_CONFIG.VERSION}: ` +
    getProjectReleaseUrl(),
  );
  if (availableUpdate) {
    lines.push(
      `New version available: v${availableUpdate.version}: ` +
      availableUpdate.releaseUrl,
    );
  }
  lines.push(`Repository: ${RETENTION_CONFIG.PROJECT_REPOSITORY_URL}`);

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
  if (!RETENTION_CONFIG.VERBOSE_LOGGING) {
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
  if (!RETENTION_CONFIG.VERBOSE_LOGGING) {
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
