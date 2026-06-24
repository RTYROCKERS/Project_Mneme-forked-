/**
 * Knowledge Engine
 * Uses the Gemini API to extract concepts from resource content.
 */

const { generateText } = require('../config/gemini');

/**
 * Extract concepts from raw text content.
 *
 * @param {string} content     - the resource text/URL content
 * @param {string} topicName   - the topic name for context
 * @param {string} depth       - depth level: beginner | intermediate | advanced
 * @param {string} goal        - learning goal: interviews | exams | general
 * @param {string} userProfile - formatted learner profile for personalization
 * @returns {Array<{name, description, difficulty_level}>}
 */
async function extractConcepts(content, topicName, depth = 'intermediate', goal = 'general', userProfile = '') {
  const profileLine = userProfile && userProfile.trim()
    ? `Learner profile (tailor concept selection and descriptions to this learner):\n${userProfile.trim()}\n`
    : '';

  const prompt = `
You are a knowledge extraction expert. Extract key concepts from the following learning material.

Topic: "${topicName}"
Depth level: ${depth}
Learning goal: ${goal}
${profileLine}
For each concept, provide:
- name: short concept name (3-6 words max)
- description: 1-2 sentence explanation
- difficulty_level: "easy" | "intermediate" | "hard" (based on depth and goal)

Return ONLY a valid JSON array of concept objects. No markdown, no explanation.
Example format:
[{"name":"Binary Search","description":"A divide-and-conquer search algorithm.","difficulty_level":"intermediate"}]

Material:
${content.slice(0, 4000)}
`.trim();

  const raw = (await generateText(prompt, { temperature: 0.3, maxOutputTokens: 1500 })).trim();

  // Strip markdown code fences if present
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  const concepts = JSON.parse(json);

  if (!Array.isArray(concepts)) throw new Error('Model did not return an array');

  return concepts.map((c) => ({
    name: String(c.name || '').trim(),
    description: String(c.description || '').trim(),
    difficulty_level: ['easy', 'intermediate', 'hard'].includes(c.difficulty_level)
      ? c.difficulty_level
      : 'intermediate',
  }));
}

/**
 * Generate a structured concept list directly from a topic and its description
 * (no external resources). Breadth/depth adapts to how detailed the
 * description is and to the learner's profile.
 *
 * @param {string} topicName
 * @param {string} topicDescription
 * @param {string} depth         - the topic's depth level
 * @param {string} goal          - the topic's learning goal
 * @param {string} userProfile   - formatted learner profile for personalization
 * @returns {Array<{name, description, difficulty_level}>}
 */
async function generateConceptsForTopic(topicName, topicDescription, depth = 'intermediate', goal = 'general', userProfile = '') {
  const profileLine = userProfile && userProfile.trim()
    ? `Learner profile (tailor concept selection and descriptions to this learner):\n${userProfile.trim()}\n`
    : '';

  const prompt = `
You are an expert curriculum designer. Design a concept map for a learner studying a topic.

Topic: "${topicName}"
Depth level: ${depth}
Learning goal: ${goal}
Learner's topic description (what they want to cover and how deep):
${topicDescription && topicDescription.trim() ? topicDescription.trim() : '(none provided — infer a sensible scope)'}

${profileLine}
Decide BREADTH and DEPTH from the description and depth level:
- If the description is detailed or asks for comprehensive/deep coverage, return MANY granular concepts (about 12-20).
- If it is brief or high-level, return FEWER, BROADER concepts (about 5-8).

For each concept provide:
- name: short concept name (3-6 words max)
- description: 1-2 sentence explanation tailored to the learner
- difficulty_level: "easy" | "intermediate" | "hard"

Order concepts from foundational to advanced.
Return ONLY a valid JSON array of concept objects. No markdown, no commentary.
Example: [{"name":"Binary Search","description":"A divide-and-conquer search algorithm.","difficulty_level":"intermediate"}]
`.trim();

  const raw = (await generateText(prompt, { temperature: 0.4, maxOutputTokens: 2000 })).trim();
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const concepts = JSON.parse(json);

  if (!Array.isArray(concepts)) throw new Error('Model did not return an array');

  return concepts
    .filter((c) => c && c.name)
    .map((c) => ({
      name: String(c.name || '').trim(),
      description: String(c.description || '').trim(),
      difficulty_level: ['easy', 'intermediate', 'hard'].includes(c.difficulty_level)
        ? c.difficulty_level
        : 'intermediate',
    }));
}

module.exports = { extractConcepts, generateConceptsForTopic };
