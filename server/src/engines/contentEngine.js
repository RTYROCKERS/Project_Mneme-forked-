/**
 * Content Generation Engine
 * Generates adaptive revision notes and quiz questions using the Gemini API,
 * personalized to the learner's profile. Generation is driven purely by the
 * concept, its description and the topic context — no external resources.
 */

const { generateJSON } = require('../config/llm');

function profileBlock(userProfile) {
  return userProfile && userProfile.trim()
    ? `Learner profile (personalize tone, depth, examples and difficulty for this learner):\n${userProfile.trim()}`
    : 'Learner profile: not provided. Use sensible defaults.';
}

function topicBlock(topicDescription) {
  return topicDescription && topicDescription.trim()
    ? `Topic context (what the learner wants from this topic):\n${topicDescription.trim()}`
    : '';
}

// Gemini responseSchema (OpenAPI-subset) for a revision note. Passed as
// generationConfig.responseSchema so the model is constrained to this exact
// shape at generation time, not just asked nicely in the prompt.
const REVISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING' },
    title: { type: 'STRING' },
    summary: { type: 'STRING' },
    key_points: { type: 'ARRAY', items: { type: 'STRING' } },
    analogy: { type: 'STRING' },
    common_mistakes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['type', 'title', 'summary', 'key_points', 'analogy', 'common_mistakes'],
};

// responseSchema for the quiz-questions array.
const QUIZ_QUESTIONS_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      question: { type: 'STRING' },
      options: { type: 'ARRAY', items: { type: 'STRING' } },
      correct_index: { type: 'INTEGER' },
      explanation: { type: 'STRING' },
    },
    required: ['question', 'options', 'correct_index', 'explanation'],
  },
};

/**
 * Generate revision content for a concept.
 * @returns {{ type: 'revision', title, summary, key_points: [], analogy, common_mistakes: [] }}
 */
async function generateRevision(conceptName, conceptDescription, masteryScore, difficulty, userProfile = '', topicDescription = '') {
  const level = masteryScore < 0.4 ? 'beginner' : masteryScore < 0.7 ? 'intermediate' : 'advanced';

  const prompt = `
Generate a revision note for the concept: "${conceptName}"
Concept description: ${conceptDescription}
Difficulty: ${difficulty}
Student mastery level: ${level} (mastery score: ${masteryScore.toFixed(2)})

${topicBlock(topicDescription)}

${profileBlock(userProfile)}

Respond with a single JSON object matching the required schema exactly:
- "type" must be the literal string "revision"
- "key_points" must contain exactly 4 short strings
- "common_mistakes" must contain exactly 2 short strings
Keep "summary" to 2-3 sentences and "analogy" to 1-2 sentences so the whole
response fits comfortably within the token budget.
`.trim();

  try {
    return await generateJSON(prompt, {
      temperature: 0.5,
      maxOutputTokens: 1500,
      responseSchema: REVISION_SCHEMA,
    });
  } catch (error) {
    // If we got cut off mid-generation, retry once with a tighter, cheaper
    // ask instead of surfacing a raw parse error to the frontend.
    if (error.truncated) {
      console.error('Revision generation truncated, retrying with reduced scope:', error.message);
      return generateJSON(
        `${prompt}\n\nKeep the summary to 1-2 sentences and the analogy to one short sentence to stay well within limits.`,
        { temperature: 0.5, maxOutputTokens: 1500, responseSchema: REVISION_SCHEMA },
      );
    }
    throw error;
  }
}

/**
 * Generate a set of standalone quiz questions for a concept. Used both for the
 * on-demand quiz and to seed the reusable question bank.
 * @returns {Array<{ question, options: [], correct_index, explanation }>}
 */
async function generateQuizQuestions(conceptName, conceptDescription, masteryScore, difficulty, userProfile = '', topicDescription = '', count = 4) {
  const level = masteryScore < 0.4 ? 'basic recall' : masteryScore < 0.7 ? 'applied understanding' : 'deep analysis';

  const prompt = `
Generate exactly ${count} multiple-choice quiz questions for the concept: "${conceptName}"
Concept description: ${conceptDescription}
Difficulty: ${difficulty}
Focus on: ${level}

${topicBlock(topicDescription)}

${profileBlock(userProfile)}

Respond with a single JSON array (no wrapper object) matching the required
schema exactly. For every question:
- "options" must contain exactly 4 strings, prefixed "A. "/"B. "/"C. "/"D. "
- "correct_index" is the 0-based index into "options" of the correct answer
- "explanation" should be 1 short sentence
Keep every field concise so all ${count} questions fit within the token budget.
`.trim();

  try {
    const result = await generateJSON(prompt, {
      temperature: 0.4,
      maxOutputTokens: 4000,
      responseSchema: QUIZ_QUESTIONS_SCHEMA,
    });

    const questions = Array.isArray(result) ? result : result?.questions || [];
    return questions
      .filter((q) => q && q.question && Array.isArray(q.options))
      .map((q) => ({
        question: String(q.question).trim(),
        options: q.options.map((o) => String(o)),
        correct_index: Number.isInteger(q.correct_index) ? q.correct_index : 0,
        explanation: String(q.explanation || '').trim(),
      }));
  } catch (error) {
    // Only worth retrying with a smaller ask if we actually got cut off —
    // a genuinely malformed reply from a schema-constrained call is rare and
    // retrying the same request is unlikely to help.
    if (error.truncated && count > 2) {
      console.error(`Quiz generation truncated at count=${count}, retrying with fewer questions:`, error.message);
      return generateQuizQuestions(conceptName, conceptDescription, masteryScore, difficulty, userProfile, topicDescription, Math.max(2, Math.floor(count / 2)));
    }
    console.error('Quiz generation failed:', error.message);
    return []; // Graceful failure array so the frontend doesn't throw a hard 502 crash
  }
}

/**
 * Generate a full quiz payload for a concept (kept for the standalone quiz mode).
 * @returns {{ type: 'quiz', concept, questions: [...] }}
 */
async function generateQuiz(conceptName, conceptDescription, masteryScore, difficulty, userProfile = '', topicDescription = '') {
  const questions = await generateQuizQuestions(conceptName, conceptDescription, masteryScore, difficulty, userProfile, topicDescription, 5);
  return { type: 'quiz', concept: conceptName, questions };
}

module.exports = { generateRevision, generateQuiz, generateQuizQuestions };
