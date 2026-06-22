/**
 * Knowledge Engine
 * Uses OpenAI GPT-4o to extract concepts from resource content.
 */

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Extract concepts from raw text content.
 *
 * @param {string} content     - the resource text/URL content
 * @param {string} topicName   - the topic name for context
 * @param {string} depth       - depth level: beginner | intermediate | advanced
 * @param {string} goal        - learning goal: interviews | exams | general
 * @returns {Array<{name, description, difficulty_level}>}
 */
async function extractConcepts(content, topicName, depth = 'intermediate', goal = 'general') {
  const prompt = `
You are a knowledge extraction expert. Extract key concepts from the following learning material.

Topic: "${topicName}"
Depth level: ${depth}
Learning goal: ${goal}

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

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1500,
  });

  const raw = response.choices[0].message.content.trim();

  // Strip markdown code fences if present
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  const concepts = JSON.parse(json);

  if (!Array.isArray(concepts)) throw new Error('GPT did not return an array');

  return concepts.map((c) => ({
    name: String(c.name || '').trim(),
    description: String(c.description || '').trim(),
    difficulty_level: ['easy', 'intermediate', 'hard'].includes(c.difficulty_level)
      ? c.difficulty_level
      : 'intermediate',
  }));
}

module.exports = { extractConcepts };
