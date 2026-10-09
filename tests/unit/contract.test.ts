import contractSnapshot from '../../contract/api-contract.json';
import { buildContract } from '../../src/schemas/contract';

describe('published API contract', () => {
  it('matches contract/api-contract.json (run `npm run contract:export` and update the frontend copy on change)', () => {
    expect(JSON.parse(JSON.stringify(buildContract()))).toEqual(contractSnapshot);
  });
});
