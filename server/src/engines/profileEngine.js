/**
 * Profile Engine
 * Powers the conversational coach that helps a learner build/refine their
 * learner profile, and synthesizes the conversation into a structured profile.
 */

const { chat, generateJSON } = require('../config/llm');

const COACH_SYSTEM = `
You are Mneme's friendly learning coach. Your job is to interview the learner
in a warm, concise way to understand:
- their point of view and background (what they already know, their context)
- their learning ability and preferences (how they learn best, pace, strengths, struggles)
- their goals (what they want to achieve, deadlines, why it matters)

Ask one focused question at a time. Keep replies short (2-4 sentences).
When you feel you have enough to describe the learner, tell them they can
save their profile. Never invent facts about the learner.
`.trim();

/**
 * Continue the coaching conversation.
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 * @returns {Promise<string>} the assistant's next message
 */
async function chatWithCoach(history) {
  const messages = (history || [])
    .filter((m) => m && m.content)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content),
    }));

  if (messages.length === 0) {
    messages.push({ role: 'user', content: 'Help me build my learner profile.' });
  }

  return chat(messages, { temperature: 0.7, maxOutputTokens: 500, system: COACH_SYSTEM });
}

/**
 * Synthesize the conversation into a structured learner profile.
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 * @returns {Promise<{ profile_description: string, learning_ability: string, goals: string, preferences: string, pov: string }>}
 */
async function synthesizeProfile(history) {
  const transcript = (history || [])
    .filter((m) => m && m.content)
    .map((m) => `${m.role === 'assistant' ? 'Coach' : 'Learner'}: ${m.content}`)
    .join('\n');

  const prompt = `
Based on the conversation below, write a concise learner profile.

Conversation:
${transcript || '(no conversation yet)'}

Return ONLY valid JSON with this shape:
{
  "profile_description": "A 2-4 sentence first-person summary capturing the learner's point of view, ability and goals. This is sent to the content generator to personalize material.",
  "learning_ability": "short description of how they learn best, pace, strengths and struggles",
  "goals": "short description of what they want to achieve and why",
  "preferences": "short description of format/tone/example preferences",
  "pov": "short description of their background and current perspective"
}
`.trim();

  return generateJSON(prompt, { temperature: 0.3, maxOutputTokens: 600 });
}

module.exports = { chatWithCoach, synthesizeProfile };
