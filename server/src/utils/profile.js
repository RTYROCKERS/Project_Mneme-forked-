/**
 * Formats a user's stored profile into a compact, prompt-friendly block that
 * is injected into every AI generation so content is personalized to the
 * learner's point of view, ability and goals.
 *
 * @param {{ profile_description?: string|null, profile?: object|null }} [row]
 * @returns {string}
 */
function formatUserProfile(row) {
  if (!row) return '';

  const parts = [];

  if (row.profile_description && String(row.profile_description).trim()) {
    parts.push(String(row.profile_description).trim());
  }

  if (row.profile && typeof row.profile === 'object' && Object.keys(row.profile).length > 0) {
    parts.push(`Structured profile: ${JSON.stringify(row.profile)}`);
  }

  return parts.join('\n');
}

module.exports = { formatUserProfile };
