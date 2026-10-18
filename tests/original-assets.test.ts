import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const expected = {
  "index.html": "94e7bc28e0bb5d7931e090f4b88ea52d9b6afebf9258c1b407a6570631b4a78d",
  "mockup.html": "b77a89f6c953683b3d79bd616a31db7babd1e9f05a5bad2137524850e6570181",
  "brand.html": "fcb7b5bebf036f32d2204437aaec2f7351400b04aaa21de74ce04c9d335da630"
};
test('the original marketing, mockup and brand assets remain unchanged',()=>{
  for(const [file,hash] of Object.entries(expected)) assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),hash,file);
});
