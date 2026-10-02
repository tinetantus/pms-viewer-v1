import test from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges, validateSuggestions } from '../packages/domain/ai';
const suggestion = {
  region_id: 'r1',
  proposed_type: 'text_changed',
  description: 'Label changed',
  uncertainty: 'medium',
  suggested_issue_ids: ['i1'],
  rationale: 'Same requested wording',
};
test('AI cannot introduce IDs or mutation instructions', () => {
  assert.equal(validateSuggestions({ suggestions: [suggestion] }, ['r1'], ['i1']).length, 1);
  assert.throws(() =>
    validateSuggestions(
      { suggestions: [{ ...suggestion, suggested_issue_ids: ['outside'] }] },
      ['r1'],
      ['i1'],
    ),
  );
  assert.throws(() =>
    validateSuggestions({ suggestions: [{ ...suggestion, status: 'approved' }] }, ['r1'], ['i1']),
  );
  assert.throws(() =>
    validateSuggestions({ suggestions: [suggestion, suggestion] }, ['r1'], ['i1']),
  );
});
test('AI disabled or missing consent never calls provider', async () => {
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    throw new Error('Should not call');
  };
  const config = { enabled: false, policyAccepted: false, maxOutputTokens: 1000 };
  assert.equal((await describeChanges(config, [], [], transport)).status, 'disabled');
  assert.equal(
    (await describeChanges({ ...config, enabled: true }, [], [], transport)).status,
    'failed',
  );
  assert.equal(calls, 0);
});
test('AI failure preserves deterministic workflow; valid structured output parses', async () => {
  const config = {
    enabled: true,
    policyAccepted: true,
    provider: 'openai',
    model: 'test-model',
    apiKey: 'test-only',
    maxOutputTokens: 1000,
  };
  const regions = [{ id: 'r1', before: new Uint8Array([1]), after: new Uint8Array([2]) }];
  const failed = await describeChanges(
    config,
    regions,
    [],
    async () => new Response('', { status: 503 }),
  );
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.suggestions, []);
  const valid = await describeChanges(
    config,
    regions,
    [{ id: 'i1', title: 'Test', description: 'Test' }],
    async () =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify({ suggestions: [suggestion] }) }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
  );
  assert.equal(valid.status, 'succeeded');
  assert.equal(valid.usage?.input_tokens, 10);
});
