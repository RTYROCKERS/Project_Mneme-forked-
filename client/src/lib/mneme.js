import api from '@/lib/api';

/**
 * Mneme brain API surface. Thin wrappers over /api/mneme used by the Control
 * Center. Every call returns the parsed response body (or throws an axios error
 * that getErrorMessage() can format).
 */
export const mneme = {
  // Memory feed
  listMemories: (limit = 100) =>
    api.get('/mneme/memories', { params: { limit } }).then((r) => r.data),
  deleteMemory: (id) => api.delete(`/mneme/memories/${id}`).then((r) => r.data),

  // Strength / retention stats
  strength: () => api.get('/mneme/strength').then((r) => r.data),

  // Settings (modes & pause)
  getSettings: () => api.get('/mneme/settings').then((r) => r.data),
  updateSettings: (patch) => api.put('/mneme/settings', patch).then((r) => r.data),

  // Sources & permissions
  listSources: () => api.get('/mneme/sources').then((r) => r.data),
  setSource: (payload) => api.post('/mneme/sources', payload).then((r) => r.data),

  // Live recall (the demo trigger loop, from the browser)
  context: (text, { interaction, force } = {}) =>
    api.post('/mneme/context', { text, interaction, force }).then((r) => r.data.candidate),
  recall: (payload) => api.post('/mneme/recall', payload).then((r) => r.data),
  explain: (memory_id) =>
    api.post('/mneme/explain', { memory_id }).then((r) => r.data),

  // Capture (observe text) + demo seed
  capture: (text, source) =>
    api.post('/mneme/capture', { text, source }).then((r) => r.data),
  seedDemo: (opts = {}) => api.post('/mneme/seed-demo', opts).then((r) => r.data),

  // First-run onboarding (cold-start) + editing the prior / adding anchors later
  getOnboarding: () => api.get('/mneme/onboarding').then((r) => r.data),
  saveOnboarding: (payload) => api.post('/mneme/onboarding', payload).then((r) => r.data),

  // "Learn this page" — recall what's fading + teach what's new
  pageInsight: (payload) => api.post('/mneme/page-insight', payload).then((r) => r.data),
  learnNow: (payload) => api.post('/mneme/learn-now', payload).then((r) => r.data),

  // "Get me ready to read this document" — the universal document surface.
  // Pass either { file } (PDF/Word/PPT/Excel/text) or { text, title } (pasted).
  docInsight: ({ file, text, title } = {}) => {
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      if (title) fd.append('title', title);
      // Let the browser set the multipart boundary by clearing the JSON default.
      return api
        .post('/mneme/doc-insight', fd, { headers: { 'Content-Type': undefined } })
        .then((r) => r.data);
    }
    return api.post('/mneme/doc-insight', { text, title }).then((r) => r.data);
  },

  // Save a whole briefing (refreshers + gaps + key points) into Topics/Study.
  studyPacket: (payload) => api.post('/mneme/study-packet', payload).then((r) => r.data),

  // Learning queue ("learn later" backlog)
  listLearnQueue: (status = 'pending') =>
    api.get('/mneme/learn-queue', { params: { status } }).then((r) => r.data),
  queueLearn: (payload) => api.post('/mneme/learn-queue', payload).then((r) => r.data),
  resolveQueueItem: (id, action) =>
    api.post(`/mneme/learn-queue/${id}/resolve`, { action }).then((r) => r.data),
};

export default mneme;
