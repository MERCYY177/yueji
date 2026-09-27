import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../yueji-appearance.js', import.meta.url), 'utf8');

assert.doesNotMatch(source, /id=["']yuejiNickname["']/, 'settings must not expose a nickname field');
assert.doesNotMatch(source, /id=["']yuejiSignature["']/, 'settings must not expose a signature field');
assert.doesNotMatch(source, /显示昵称\s*\/\s*个性签名/, 'export must not depend on profile-style nickname/signature controls');
assert.match(source, /<h4>外观<\/h4>/, 'appearance settings should be an appearance-only section');
assert.match(source, /id=["']yuejiExportCredit["']/, 'export settings must provide one optional export credit field');
assert.match(source, /导出署名（可选）/, 'the export credit field must be clearly optional');
